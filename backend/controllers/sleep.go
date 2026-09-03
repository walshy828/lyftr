package controllers

import (
	"database/sql"
	"strconv"
	"time"

	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

func (h *Handler) ListSleepSessions(c *gin.Context) {
	uid := middleware.UserID(c)
	from, to := parseFromTo(c)
	sessions, err := h.s.Sleep.List(uid, from, to)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, sessions)
}

func (h *Handler) GetSleepDailySummary(c *gin.Context) {
	uid := middleware.UserID(c)
	from, to := parseFromTo(c)
	summary, err := h.s.Sleep.DailySummary(uid, from, to)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, summary)
}

func (h *Handler) GetSleepSession(c *gin.Context) {
	uid := middleware.UserID(c)
	sid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	session, err := h.s.Sleep.Get(uid, sid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "sleep session not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, session)
}

// GetSleepSessionDetail enriches one sleep session with the raw heart-rate
// samples and HRV/resting-HR readings recorded within its own
// [started_at, ended_at] window, for a drill-down view. Composed here rather
// than in SleepStore since it spans heart-rate and health-metric data too.
func (h *Handler) GetSleepSessionDetail(c *gin.Context) {
	uid := middleware.UserID(c)
	sid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	session, err := h.s.Sleep.Get(uid, sid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "sleep session not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}

	window := sql.NullTime{Time: session.StartedAt, Valid: true}
	windowEnd := sql.NullTime{Time: session.EndedAt, Valid: true}

	samples, err := h.s.HeartRate.List(uid, window, windowEnd)
	if utils.DBError(c, err) {
		return
	}
	hrv, err := h.s.HealthMetric.List(uid, models.MetricTypeHRVRMSSD, window, windowEnd)
	if utils.DBError(c, err) {
		return
	}
	restingHR, err := h.s.HealthMetric.List(uid, models.MetricTypeRestingHeartRate, window, windowEnd)
	if utils.DBError(c, err) {
		return
	}

	utils.OK(c, models.SleepSessionDetail{
		SleepSession:      session,
		HeartRateSamples:  samples,
		HRVReadings:       hrv,
		RestingHRReadings: restingHR,
	})
}

// GetSleepTrend returns sleep-stage averages bucketed by day or ISO week
// (?bucket=day|week, default week) over a date window, paired with the same
// window's average resting heart rate per bucket so sleep quality and
// recovery can be plotted together without a client-side join.
func (h *Handler) GetSleepTrend(c *gin.Context) {
	uid := middleware.UserID(c)
	bucket := c.Query("bucket")
	if bucket == "" {
		bucket = "week"
	}
	if bucket != "day" && bucket != "week" {
		utils.BadRequest(c, "bucket must be day or week")
		return
	}

	from, to, tzOffset, _, ok := parseStatsWindow(c)
	if !ok {
		return
	}
	fromBound, toBound := localDateWindowToUTC(from, to, tzOffset)

	points, err := h.s.Sleep.Trend(uid, fromBound, toBound, tzOffset, bucket)
	if utils.DBError(c, err) {
		return
	}

	restingHR, err := h.s.HealthMetric.List(uid, models.MetricTypeRestingHeartRate, fromBound, toBound)
	if utils.DBError(c, err) {
		return
	}
	sums := map[string]float64{}
	counts := map[string]int{}
	for _, m := range restingHR {
		key := stores.SleepTrendBucketKey(m.RecordedAt, tzOffset, bucket)
		sums[key] += m.Value
		counts[key]++
	}
	for i := range points {
		if n := counts[points[i].Bucket]; n > 0 {
			avg := sums[points[i].Bucket] / float64(n)
			points[i].AvgRestingHR = &avg
		}
	}

	utils.OK(c, points)
}

// localDateWindowToUTC converts a [from, to] pair of local calendar dates
// (as parsed by parseStatsWindow) plus the client's tz_offset into UTC time
// bounds suitable for the sql.NullTime-based store queries (List, Trend).
func localDateWindowToUTC(from, to string, tzOffset int) (sql.NullTime, sql.NullTime) {
	loc := time.FixedZone("client", tzOffset*60)
	fromT, _ := time.ParseInLocation(isoDate, from, loc)
	toT, _ := time.ParseInLocation(isoDate, to, loc)
	toT = toT.AddDate(0, 0, 1).Add(-time.Nanosecond) // end of the local "to" day
	return sql.NullTime{Time: fromT, Valid: true}, sql.NullTime{Time: toT, Valid: true}
}

// ImportSleepSessions accepts a batch of sleep sessions (with stage detail)
// from a sync job (e.g. the Android companion app reading Health Connect).
// Safe to call repeatedly — sessions are upserted on external_id, with their
// stages replaced wholesale on each resubmit.
func (h *Handler) ImportSleepSessions(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.BatchImportSleepSessionsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}

	imported, updated, err := h.s.Sleep.Import(uid, req.Sessions)
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, gin.H{"imported": imported, "updated": updated, "submitted": len(req.Sessions)})
}
