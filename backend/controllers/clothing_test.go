package controllers

import (
	"net/http"
	"strconv"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
)

func listProfiles(t *testing.T, uid int64) []any {
	t.Helper()
	c, w := newContext(uid, http.MethodGet, "/api/v1/weight/clothing", nil)
	th.ListClothingProfiles(c)
	if w.Code != http.StatusOK {
		t.Fatalf("list profiles: %d %s", w.Code, w.Body.String())
	}
	return decodeResponse(t, w)["data"].([]any)
}

func profileID(p any) int64 { return int64(p.(map[string]any)["id"].(float64)) }

func TestClothing_seedsDefaultsAndBackfillsHistory(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	insertWeightLog(t, uid, 180, time.Now().AddDate(0, 0, -3))

	profiles := listProfiles(t, uid)
	if len(profiles) != 3 {
		t.Fatalf("want 3 starter profiles, got %d", len(profiles))
	}
	first := profiles[0].(map[string]any)
	if first["name"] != "Summer" || first["is_default"] != true || first["offset_lbs"].(float64) != 0 {
		t.Fatalf("first profile should be default Summer/0, got %v", first)
	}

	var pid int64
	if err := db.DB.QueryRow(`SELECT clothing_profile_id FROM weight_logs WHERE user_id = ?`, uid).Scan(&pid); err != nil {
		t.Fatalf("history not back-filled: %v", err)
	}
	if pid != profileID(profiles[0]) {
		t.Fatalf("history should link to Summer, got %d", pid)
	}
	// Idempotent.
	if len(listProfiles(t, uid)) != 3 {
		t.Fatal("second list should not re-seed")
	}
}

func TestClothing_loggedWeightIsAdjustedAndEditRecomputes(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	profiles := listProfiles(t, uid)
	winter := profileID(profiles[2]) // +4

	c, w := newContext(uid, http.MethodPost, "/api/v1/weight", map[string]any{
		"weight": 184.0, "clothing_profile_id": winter,
	})
	th.LogWeight(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("log: %d %s", w.Code, w.Body.String())
	}
	log := decodeResponse(t, w)["data"].(map[string]any)
	if log["weight"].(float64) != 180 || log["raw_weight"].(float64) != 184 || log["clothing_offset"].(float64) != 4 {
		t.Fatalf("unexpected log %v", log)
	}

	// Stats use adjusted weight.
	c, w = newContext(uid, http.MethodGet, "/api/v1/weight/stats", nil)
	th.GetWeightStats(c)
	if got := decodeResponse(t, w)["data"].(map[string]any)["latest"].(float64); got != 180 {
		t.Fatalf("stats latest = %v, want 180", got)
	}

	// Editing the offset re-adjusts the existing entry.
	c, w = newContext(uid, http.MethodPatch, "/api/v1/weight/clothing/x", map[string]any{"name": "Winter", "offset_lbs": 5.0})
	setParam(c, "id", strconv.FormatInt(winter, 10))
	th.UpdateClothingProfile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("update profile: %d %s", w.Code, w.Body.String())
	}
	c, w = newContext(uid, http.MethodGet, "/api/v1/weight", nil)
	th.ListWeightLogs(c)
	row := decodeResponse(t, w)["data"].([]any)[0].(map[string]any)
	if row["weight"].(float64) != 179 {
		t.Fatalf("after offset edit weight = %v, want 179", row["weight"])
	}
}

func TestClothing_newEntryDefaultsToSummerAndRejectsForeignProfile(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	listProfiles(t, uid)

	c, w := newContext(uid, http.MethodPost, "/api/v1/weight", map[string]any{"weight": 175.0})
	th.LogWeight(c)
	log := decodeResponse(t, w)["data"].(map[string]any)
	if log["weight"].(float64) != 175 || log["clothing_profile_id"] == nil {
		t.Fatalf("default entry should link to Summer unadjusted, got %v", log)
	}

	other, _ := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, ?)`, "o@o.com", "x")
	otherUID, _ := other.LastInsertId()
	foreign := profileID(listProfiles(t, otherUID)[2])
	c, w = newContext(uid, http.MethodPost, "/api/v1/weight", map[string]any{"weight": 175.0, "clothing_profile_id": foreign})
	th.LogWeight(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("foreign profile should 400, got %d", w.Code)
	}
}

func TestClothing_deleteReassignsToDefaultAndProtectsDefault(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	profiles := listProfiles(t, uid)
	summer, winter := profileID(profiles[0]), profileID(profiles[2])

	c, _ := newContext(uid, http.MethodPost, "/api/v1/weight", map[string]any{"weight": 184.0, "clothing_profile_id": winter})
	th.LogWeight(c)

	c, w := newContext(uid, http.MethodDelete, "/api/v1/weight/clothing/x", nil)
	setParam(c, "id", strconv.FormatInt(summer, 10))
	th.DeleteClothingProfile(c)
	if w.Code != http.StatusConflict {
		t.Fatalf("deleting default should 409, got %d", w.Code)
	}

	c, w = newContext(uid, http.MethodDelete, "/api/v1/weight/clothing/x", nil)
	setParam(c, "id", strconv.FormatInt(winter, 10))
	th.DeleteClothingProfile(c)
	if w.Code != http.StatusOK {
		t.Fatalf("delete: %d %s", w.Code, w.Body.String())
	}
	var pid int64
	var raw float64
	if err := db.DB.QueryRow(`SELECT clothing_profile_id, weight FROM weight_logs WHERE user_id = ?`, uid).Scan(&pid, &raw); err != nil || pid != summer || raw != 184 {
		t.Fatalf("entry should move to Summer keeping raw 184, got pid=%d raw=%v err=%v", pid, raw, err)
	}
}
