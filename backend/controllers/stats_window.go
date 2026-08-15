package controllers

import (
	"strconv"
	"time"

	"github.com/Cawlumm/lyftr-backend/stores"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/gin-gonic/gin"
)

// maxStatsSpanDays bounds the requested window. A year of daily rows is what
// the full-year heatmap needs; the slack above that covers a client asking for
// "last year plus this one" without letting a caller ask for a decade.
const maxStatsSpanDays = 400

// defaultStatsSpanDays is the window when the caller names neither end: the
// trailing year, which is exactly the heatmap's span.
const defaultStatsSpanDays = 365

const isoDate = "2006-01-02"

// parseStatsWindow parses the from/to/tz_offset query params shared by every
// stats-over-a-date-window endpoint (workouts, cardio). On invalid input it
// writes the error response itself and returns ok=false — callers just do
// `from, to, tzOffset, today, ok := parseStatsWindow(c); if !ok { return }`.
//
// Dates are the CLIENT's local calendar days. The server stores no per-user
// timezone, so the client sends tz_offset (minutes to add to UTC) and is the
// authority on when its own day starts.
func parseStatsWindow(c *gin.Context) (from, to string, tzOffset int, today string, ok bool) {
	if v, err := strconv.Atoi(c.Query("tz_offset")); err == nil {
		tzOffset = v
	}
	today = stores.LocalToday(tzOffset)

	to = today
	if raw := c.Query("to"); raw != "" {
		t, err := time.Parse(isoDate, raw)
		if err != nil {
			utils.BadRequest(c, "to must be a YYYY-MM-DD date")
			return "", "", 0, "", false
		}
		to = t.Format(isoDate)
	}

	toTime, _ := time.Parse(isoDate, to)
	from = toTime.AddDate(0, 0, -(defaultStatsSpanDays - 1)).Format(isoDate)
	if raw := c.Query("from"); raw != "" {
		t, err := time.Parse(isoDate, raw)
		if err != nil {
			utils.BadRequest(c, "from must be a YYYY-MM-DD date")
			return "", "", 0, "", false
		}
		from = t.Format(isoDate)
	}

	if from > to {
		utils.BadRequest(c, "from must not be after to")
		return "", "", 0, "", false
	}
	fromTime, _ := time.Parse(isoDate, from)
	if int(toTime.Sub(fromTime).Hours()/24)+1 > maxStatsSpanDays {
		utils.BadRequest(c, "date range must not exceed "+strconv.Itoa(maxStatsSpanDays)+" days")
		return "", "", 0, "", false
	}

	return from, to, tzOffset, today, true
}
