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

// stampBPCategory fills the derived ACC/AHA category on readings before they go
// out on the wire, so no client re-implements the thresholds.
func stampBPCategory(logs []models.BloodPressureLog) []models.BloodPressureLog {
	for i := range logs {
		logs[i].Category = utils.ClassifyBP(logs[i].Systolic, logs[i].Diastolic)
	}
	return logs
}

func (h *Handler) ListBloodPressureLogs(c *gin.Context) {
	uid := middleware.UserID(c)
	f := stores.BPFilter{Limit: 90}
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 && l <= 1000 {
		f.Limit = l
	}
	if o, err := strconv.Atoi(c.Query("offset")); err == nil && o >= 0 {
		f.Offset = o
	}

	// Same calendar-day widening as ListWeightLogs: a bare YYYY-MM-DD is a local
	// day we can't pin to a UTC instant, so widen by ±12h; a full RFC3339
	// timestamp is used exactly. (parseDayOrTime lives in weight.go.)
	if from := c.Query("from"); from != "" {
		if t, exact, ok := parseDayOrTime(from); ok {
			lo := t
			if !exact {
				lo = t.Add(-12 * time.Hour)
			}
			f.From = &lo
		}
	}
	if to := c.Query("to"); to != "" {
		if t, exact, ok := parseDayOrTime(to); ok {
			hi := t
			if !exact {
				hi = t.Add(36 * time.Hour)
			}
			f.To = &hi
		}
	}

	logs, err := h.s.BloodPressure.List(uid, f)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, stampBPCategory(logs))
}

// bindBPRequest handles the shared bind/validate/normalize for create and
// update, including the cross-field rule validate can't express.
func bindBPRequest(c *gin.Context) (models.LogBloodPressureRequest, bool) {
	var req models.LogBloodPressureRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return req, false
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return req, false
	}
	if req.Systolic <= req.Diastolic {
		utils.BadRequest(c, "systolic must be higher than diastolic")
		return req, false
	}
	req.LoggedAt = normalizeLoggedAt(req.LoggedAt)
	return req, true
}

func (h *Handler) LogBloodPressure(c *gin.Context) {
	uid := middleware.UserID(c)
	req, ok := bindBPRequest(c)
	if !ok {
		return
	}

	log, err := h.s.BloodPressure.Create(uid, req)
	if utils.DBError(c, err) {
		return
	}
	log.Category = utils.ClassifyBP(log.Systolic, log.Diastolic)
	utils.Created(c, log)
}

func (h *Handler) GetBloodPressureLog(c *gin.Context) {
	uid := middleware.UserID(c)
	lid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	log, err := h.s.BloodPressure.Get(uid, lid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "reading not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	log.Category = utils.ClassifyBP(log.Systolic, log.Diastolic)
	utils.OK(c, log)
}

func (h *Handler) UpdateBloodPressureLog(c *gin.Context) {
	uid := middleware.UserID(c)
	lid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	req, ok := bindBPRequest(c)
	if !ok {
		return
	}

	log, err := h.s.BloodPressure.Update(uid, lid, req)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "reading not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	log.Category = utils.ClassifyBP(log.Systolic, log.Diastolic)
	utils.OK(c, log)
}

func (h *Handler) DeleteBloodPressureLog(c *gin.Context) {
	uid := middleware.UserID(c)
	lid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}
	n, err := h.s.BloodPressure.Delete(uid, lid)
	if utils.DBError(c, err) {
		return
	}
	if n == 0 {
		utils.NotFound(c, "reading not found")
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}

// bpStatsLookbackDays bounds the analytics read. 90 days covers the longest
// window we report and keeps the payload small enough to render the chart from
// directly.
const bpStatsLookbackDays = 90

// bpStatWindows are the reporting windows, shortest first: this week, this
// month, this quarter.
var bpStatWindows = []int{7, 30, 90}

// GetBloodPressureStats returns the complete deterministic picture: windowed
// averages, the daily series for the chart, the fitted trend, and the capture
// protocol guidance.
//
// Nothing here touches the AI provider — this is what the blood pressure page
// renders on first paint, and it is fully useful on a server with no provider
// configured.
func (h *Handler) GetBloodPressureStats(c *gin.Context) {
	uid := middleware.UserID(c)
	now := time.Now().UTC()

	logs, err := h.s.BloodPressure.ListSince(uid, bpStatsLookbackDays)
	if utils.DBError(c, err) {
		return
	}
	total, err := h.s.BloodPressure.Count(uid)
	if utils.DBError(c, err) {
		return
	}

	sessions := utils.GroupBPSessions(logs)
	days := utils.GroupBPDays(sessions)

	windows := make([]utils.BPWindow, 0, len(bpStatWindows))
	for _, w := range bpStatWindows {
		windows = append(windows, utils.SummarizeBPWindow(days, sessions, w, now))
	}

	sysPer30d, diaPer30d, points, ok := utils.BPTrend(days, now.AddDate(0, 0, -bpStatsLookbackDays), now)
	trendLabel := ""
	if ok {
		trendLabel = utils.ClassifyBPTrend(sysPer30d, diaPer30d)
	}

	// The latest raw reading, not the latest session average — this is the
	// "what did I just measure" number, distinct from the averages above.
	var latest *models.BloodPressureLog
	if len(logs) > 0 {
		l := logs[len(logs)-1]
		l.Category = utils.ClassifyBP(l.Systolic, l.Diastolic)
		latest = &l
	}

	utils.OK(c, gin.H{
		"latest":  latest,
		"windows": windows,
		"daily":   days,
		"trend": gin.H{
			"sys_per_30d": sysPer30d,
			"dia_per_30d": diaPer30d,
			"label":       trendLabel,
			"points":      points,
		},
		"nudges":         utils.EvaluateBPProtocol(days, sessions, now),
		"total_readings": total,
		"lookback_days":  bpStatsLookbackDays,
	})
}
