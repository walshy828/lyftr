package tools

import (
	"context"
	"fmt"
	"net/url"

	"github.com/Cawlumm/lyftr-mcp/client"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

type dateRangeInput struct {
	From string `json:"from,omitempty" jsonschema:"Start date (YYYY-MM-DD or RFC3339), inclusive"`
	To   string `json:"to,omitempty" jsonschema:"End date (YYYY-MM-DD or RFC3339), inclusive"`
}

type listHealthMetricsInput struct {
	MetricType string `json:"metric_type,omitempty" jsonschema:"Filter to one metric type: hrv_rmssd, spo2, resting_heart_rate, active_calories, vo2_max, floors_climbed, steps. Omit for all types."`
	From       string `json:"from,omitempty" jsonschema:"Start date (YYYY-MM-DD or RFC3339), inclusive"`
	To         string `json:"to,omitempty" jsonschema:"End date (YYYY-MM-DD or RFC3339), inclusive"`
}

type getSleepSessionInput struct {
	ID int64 `json:"id" jsonschema:"Sleep session id"`
}

type heartRateZonesInput struct {
	MaxHR int    `json:"max_hr,omitempty" jsonschema:"Max heart rate to base zone percentages on. Omit to estimate from the user's profile birth date (220-age) — fails if neither is available."`
	From  string `json:"from,omitempty" jsonschema:"Start date (YYYY-MM-DD or RFC3339), inclusive"`
	To    string `json:"to,omitempty" jsonschema:"End date (YYYY-MM-DD or RFC3339), inclusive"`
}

// registerHealth exposes read access to the health data imported from a
// companion device's health platform (e.g. Health Connect): raw heart rate
// samples, scalar metrics (HRV, SpO2, resting heart rate, active calories,
// VO2 max, floors climbed, steps), and sleep sessions with stage detail. Import
// endpoints are deliberately not exposed here — those exist for the Android
// sync job, not for the assistant to write through.
func registerHealth(server *mcp.Server, c *client.Client) {
	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_heart_rate_samples",
		Description: "List raw heart rate samples (bpm over time) imported from Health Connect, most recent first.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in dateRangeInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfNonEmpty(q, "from", in.From)
		setIfNonEmpty(q, "to", in.To)
		data, err := c.Get(ctx, "/heart-rate", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_heart_rate_daily_stats",
		Description: "Get per-day min/avg/max heart rate, rolled up from raw samples.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in dateRangeInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfNonEmpty(q, "from", in.From)
		setIfNonEmpty(q, "to", in.To)
		data, err := c.Get(ctx, "/heart-rate/daily", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_heart_rate_zones",
		Description: "Get per-day time-in-zone minutes (the standard 5-zone model, as a percentage of max heart rate: zone 1 = 50-60%, zone 2 = 60-70%, zone 3 = 70-80%, zone 4 = 80-90%, zone 5 = 90%+), computed from raw heart rate samples.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in heartRateZonesInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfPositive(q, "max_hr", in.MaxHR)
		setIfNonEmpty(q, "from", in.From)
		setIfNonEmpty(q, "to", in.To)
		data, err := c.Get(ctx, "/heart-rate/zones", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_health_metrics",
		Description: "List scalar health metrics (HRV RMSSD, SpO2, resting heart rate, active calories, VO2 max as a cardio-load proxy, floors climbed, steps) imported from Health Connect, most recent first.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in listHealthMetricsInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfNonEmpty(q, "metric_type", in.MetricType)
		setIfNonEmpty(q, "from", in.From)
		setIfNonEmpty(q, "to", in.To)
		data, err := c.Get(ctx, "/health-metrics", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "list_sleep_sessions",
		Description: "List the user's sleep sessions with full stage breakdown (light/deep/REM/awake), imported from Health Connect, most recent first.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in dateRangeInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfNonEmpty(q, "from", in.From)
		setIfNonEmpty(q, "to", in.To)
		data, err := c.Get(ctx, "/sleep", q)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_sleep_session",
		Description: "Get one sleep session by id, with its stage breakdown.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in getSleepSessionInput) (*mcp.CallToolResult, any, error) {
		data, err := c.Get(ctx, fmt.Sprintf("/sleep/%d", in.ID), nil)
		return nil, data, err
	})

	mcp.AddTool(server, &mcp.Tool{
		Name:        "get_sleep_daily_summary",
		Description: "Get per-night total and per-stage (awake/light/deep/REM) sleep minutes, rolled up from sleep sessions.",
	}, func(ctx context.Context, _ *mcp.CallToolRequest, in dateRangeInput) (*mcp.CallToolResult, any, error) {
		q := url.Values{}
		setIfNonEmpty(q, "from", in.From)
		setIfNonEmpty(q, "to", in.To)
		data, err := c.Get(ctx, "/sleep/daily", q)
		return nil, data, err
	})
}
