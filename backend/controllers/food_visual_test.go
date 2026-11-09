package controllers

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/Cawlumm/lyftr-backend/db"
	"github.com/Cawlumm/lyftr-backend/storage"
	"github.com/Cawlumm/lyftr-backend/stores"
)

// jpegB64 is a byte string that passes the JPEG magic-number check.
var jpegB64 = base64.StdEncoding.EncodeToString([]byte{0xFF, 0xD8, 0xFF, 0xE0, 'x', 'y'})

func seedPhoto(t *testing.T, dir string, uid int64) (url, relPath string) {
	t.Helper()
	rel, err := storage.SavePhoto(dir, uid, []byte{0xFF, 0xD8, 0xFF})
	if err != nil {
		t.Fatalf("seed photo: %v", err)
	}
	return mealPhotoURLPrefix + rel, rel
}

func TestDeleteFoodLog_keepsPhotoSharedByACopy(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	dir := withTempMealPhotoDir(t)
	h := NewHandler(stores.New(db.DB), nil)
	url, rel := seedPhoto(t, dir, uid)

	src := insertFoodLog(t, uid, "Oatmeal", "breakfast", 300, 10, 50, 5, time.Now())
	db.DB.Exec(`UPDATE food_logs SET image_url = ? WHERE id = ?`, url, src)
	copies, err := h.s.Food.CopyEntries(uid, []int64{src}, "2026-01-02", "")
	if err != nil || len(copies) != 1 {
		t.Fatalf("copy: %v %d", err, len(copies))
	}

	// Undo the copy: the original still shows the photo, so the file stays.
	c, w := newContext(uid, http.MethodDelete, "/", nil)
	setParam(c, "id", fmt.Sprint(copies[0].ID))
	h.DeleteFoodLog(c)
	if w.Code != http.StatusOK {
		t.Fatalf("delete copy: %d %s", w.Code, w.Body.String())
	}
	if _, err := os.Stat(filepath.Join(dir, rel)); err != nil {
		t.Fatalf("photo removed while the original still references it: %v", err)
	}

	// Deleting the last reference does remove it.
	c2, w2 := newContext(uid, http.MethodDelete, "/", nil)
	setParam(c2, "id", fmt.Sprint(src))
	h.DeleteFoodLog(c2)
	if w2.Code != http.StatusOK {
		t.Fatalf("delete src: %d", w2.Code)
	}
	if _, err := os.Stat(filepath.Join(dir, rel)); !os.IsNotExist(err) {
		t.Errorf("expected photo removed after last reference, stat err = %v", err)
	}
}

func TestUploadFoodPhoto(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	withTempMealPhotoDir(t)
	h := NewHandler(stores.New(db.DB), nil)

	c, w := newContext(uid, http.MethodPost, "/api/v1/food/photos", map[string]any{"image_base64": jpegB64, "media_type": "image/jpeg"})
	h.UploadFoodPhoto(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
	url := decodeResponse(t, w)["data"].(map[string]any)["image_url"].(string)
	if !strings.HasPrefix(url, fmt.Sprintf("%s%d/", mealPhotoURLPrefix, uid)) {
		t.Errorf("unexpected url %q", url)
	}

	png := base64.StdEncoding.EncodeToString([]byte("\x89PNG...."))
	c2, w2 := newContext(uid, http.MethodPost, "/api/v1/food/photos", map[string]any{"image_base64": png, "media_type": "image/jpeg"})
	h.UploadFoodPhoto(c2)
	if w2.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for non-JPEG bytes, got %d", w2.Code)
	}
}

func TestSetFoodPhoto_appliesToTheSameFoodEverywhere(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	dir := withTempMealPhotoDir(t)
	h := NewHandler(stores.New(db.DB), nil)
	url, _ := seedPhoto(t, dir, uid)

	target := insertFoodLog(t, uid, "Greek Yogurt", "snacks", 150, 15, 8, 4, time.Now())
	sameOld := insertFoodLog(t, uid, "greek yogurt", "breakfast", 150, 15, 8, 4, time.Now().AddDate(0, 0, -3))
	other := insertFoodLog(t, uid, "Banana", "snacks", 100, 1, 27, 0, time.Now())
	db.DB.Exec(`INSERT INTO saved_foods (user_id, name, calories) VALUES (?, 'Greek yogurt', 150)`, uid)

	c, w := newContext(uid, http.MethodPut, "/", map[string]any{"image_url": url})
	setParam(c, "id", fmt.Sprint(target))
	h.SetFoodPhoto(c)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	img := func(q string, args ...any) string {
		var s string
		if err := db.DB.QueryRow(q, args...).Scan(&s); err != nil {
			t.Fatal(err)
		}
		return s
	}
	if got := img(`SELECT image_url FROM food_logs WHERE id = ?`, sameOld); got != url {
		t.Errorf("same food on another day not updated: %q", got)
	}
	if got := img(`SELECT image_url FROM saved_foods WHERE user_id = ?`, uid); got != url {
		t.Errorf("saved food not updated: %q", got)
	}
	if got := img(`SELECT image_url FROM food_logs WHERE id = ?`, other); got != "" {
		t.Errorf("unrelated food changed: %q", got)
	}
}

func TestSetFoodPhoto_rejectsAnotherUsersPhoto(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	withTempMealPhotoDir(t)
	h := NewHandler(stores.New(db.DB), nil)
	id := insertFoodLog(t, uid, "Toast", "breakfast", 100, 3, 18, 1, time.Now())

	c, w := newContext(uid, http.MethodPut, "/", map[string]any{"image_url": fmt.Sprintf("%s%d/x.jpg", mealPhotoURLPrefix, uid+1)})
	setParam(c, "id", fmt.Sprint(id))
	h.SetFoodPhoto(c)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", w.Code)
	}
}

func TestMealTemplates_createLogRenameDelete(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := createTestUserWithEmail(t, "other@example.com")
	withTempMealPhotoDir(t)
	h := NewHandler(stores.New(db.DB), nil)

	a := insertFoodLog(t, uid, "Eggs", "breakfast", 140, 12, 1, 10, time.Now())
	b := insertFoodLog(t, uid, "Toast", "breakfast", 100, 3, 18, 1, time.Now())
	foreign := insertFoodLog(t, other, "Not mine", "breakfast", 999, 0, 0, 0, time.Now())

	c, w := newContext(uid, http.MethodPost, "/", map[string]any{"name": "Weekday breakfast", "entry_ids": []int64{a, b, foreign}})
	h.CreateMealTemplate(c)
	if w.Code != http.StatusCreated {
		t.Fatalf("create: %d %s", w.Code, w.Body.String())
	}
	tpl := decodeResponse(t, w)["data"].(map[string]any)
	if n := len(tpl["items"].([]any)); n != 2 {
		t.Fatalf("expected 2 items (foreign entry skipped), got %d", n)
	}
	tid := fmt.Sprint(int64(tpl["id"].(float64)))

	// Logging it creates real entries on the requested day and meal.
	at := time.Date(2026, 3, 4, 17, 0, 0, 0, time.UTC)
	c2, w2 := newContext(uid, http.MethodPost, "/", map[string]any{"logged_at": at.Format(time.RFC3339), "meal": "lunch"})
	setParam(c2, "id", tid)
	h.LogMealTemplate(c2)
	if w2.Code != http.StatusCreated {
		t.Fatalf("log: %d %s", w2.Code, w2.Body.String())
	}
	logs, _ := h.s.Food.ListByDay(uid, "2026-03-04")
	if len(logs) != 2 || logs[0].Meal != "lunch" {
		t.Fatalf("expected 2 lunch entries on 2026-03-04, got %+v", logs)
	}

	// Another user can't log, rename, or delete it.
	c3, w3 := newContext(other, http.MethodPost, "/", map[string]any{"logged_at": at.Format(time.RFC3339), "meal": "lunch"})
	setParam(c3, "id", tid)
	h.LogMealTemplate(c3)
	if w3.Code != http.StatusNotFound {
		t.Errorf("foreign log: expected 404, got %d", w3.Code)
	}

	c4, w4 := newContext(uid, http.MethodPut, "/", map[string]any{"name": "Eggs on toast"})
	setParam(c4, "id", tid)
	h.RenameMealTemplate(c4)
	if w4.Code != http.StatusOK || decodeResponse(t, w4)["data"].(map[string]any)["name"] != "Eggs on toast" {
		t.Errorf("rename failed: %d", w4.Code)
	}

	c5, w5 := newContext(uid, http.MethodDelete, "/", nil)
	setParam(c5, "id", tid)
	h.DeleteMealTemplate(c5)
	if w5.Code != http.StatusOK {
		t.Errorf("delete: %d", w5.Code)
	}
	list, _ := h.s.MealTemplate.List(uid)
	if len(list) != 0 {
		t.Errorf("expected no templates after delete, got %d", len(list))
	}
}

func TestMealTemplates_rejectsAllForeignEntries(t *testing.T) {
	setupTestDB(t)
	uid := createTestUser(t)
	other := createTestUserWithEmail(t, "other2@example.com")
	h := NewHandler(stores.New(db.DB), nil)
	foreign := insertFoodLog(t, other, "Not mine", "breakfast", 999, 0, 0, 0, time.Now())

	c, w := newContext(uid, http.MethodPost, "/", map[string]any{"name": "Sneaky", "entry_ids": []int64{foreign}})
	h.CreateMealTemplate(c)
	if w.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d", w.Code)
	}
}

func createTestUserWithEmail(t *testing.T, email string) int64 {
	t.Helper()
	res, err := db.DB.Exec(`INSERT INTO users (email, password_hash) VALUES (?, 'hashed')`, email)
	if err != nil {
		t.Fatalf("create user: %v", err)
	}
	id, _ := res.LastInsertId()
	return id
}
