package stores

import (
	"database/sql"
	"fmt"

	"github.com/Cawlumm/lyftr-backend/models"
)

// FoodStore owns all SQL for food_logs and saved_foods.
type FoodStore struct{ db *sql.DB }

func NewFoodStore(db *sql.DB) *FoodStore { return &FoodStore{db: db} }

const foodLogSelect = `SELECT id, user_id, name, brand, meal, calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol, servings, serving_size, serving_size_grams, barcode, image_url, source, logged_at, created_at FROM food_logs`

func scanFoodLog(row interface{ Scan(...any) error }, f *models.FoodLog) error {
	return row.Scan(
		&f.ID, &f.UserID, &f.Name, &f.Brand, &f.Meal,
		&f.Calories, &f.Protein, &f.Carbs, &f.Fat, &f.Fiber, &f.Sugar, &f.Sodium, &f.Cholesterol,
		&f.Servings, &f.ServingSize, &f.ServingSizeGrams, &f.Barcode, &f.ImageURL, &f.Source,
		&f.LoggedAt, &f.CreatedAt,
	)
}

func (s *FoodStore) ListByDay(uid int64, date string) ([]models.FoodLog, error) {
	rows, err := s.db.Query(
		foodLogSelect+` WHERE user_id = ? AND substr(logged_at, 1, 10) = ? ORDER BY logged_at ASC`,
		uid, date,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	logs := []models.FoodLog{}
	for rows.Next() {
		var f models.FoodLog
		if err := scanFoodLog(rows, &f); err != nil {
			return nil, err
		}
		logs = append(logs, f)
	}
	return logs, rows.Err()
}

// Get returns one user-owned food log, or sql.ErrNoRows.
func (s *FoodStore) Get(uid, id int64) (models.FoodLog, error) {
	var f models.FoodLog
	err := scanFoodLog(s.db.QueryRow(foodLogSelect+` WHERE id = ? AND user_id = ?`, id, uid), &f)
	return f, err
}

func (s *FoodStore) Create(uid int64, req models.LogFoodRequest) (models.FoodLog, error) {
	res, err := s.db.Exec(
		`INSERT INTO food_logs (user_id, name, brand, meal, calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol, servings, serving_size, serving_size_grams, barcode, image_url, source, logged_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uid, req.Name, req.Brand, req.Meal, req.Calories, req.Protein, req.Carbs, req.Fat, req.Fiber, req.Sugar, req.Sodium, req.Cholesterol,
		req.Servings, req.ServingSize, req.ServingSizeGrams, req.Barcode, req.ImageURL, req.Source, req.LoggedAt,
	)
	if err != nil {
		return models.FoodLog{}, err
	}
	id, _ := res.LastInsertId()
	return s.Get(uid, id)
}

func (s *FoodStore) Update(uid, id int64, req models.LogFoodRequest) (models.FoodLog, error) {
	res, err := s.db.Exec(
		`UPDATE food_logs SET name=?, brand=?, meal=?, calories=?, protein=?, carbs=?, fat=?, fiber=?, sugar=?, sodium=?, cholesterol=?,
		 servings=?, serving_size=?, serving_size_grams=?, barcode=?, image_url=?, source=?, logged_at=?
		 WHERE id=? AND user_id=?`,
		req.Name, req.Brand, req.Meal, req.Calories, req.Protein, req.Carbs, req.Fat, req.Fiber, req.Sugar, req.Sodium, req.Cholesterol,
		req.Servings, req.ServingSize, req.ServingSizeGrams, req.Barcode, req.ImageURL, req.Source, req.LoggedAt,
		id, uid,
	)
	if err != nil {
		return models.FoodLog{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return models.FoodLog{}, sql.ErrNoRows
	}
	return s.Get(uid, id)
}

func (s *FoodStore) Delete(uid, id int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM food_logs WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}

// DailyMacros returns the day's summed macros (WorkoutCount/Date are filled by
// the caller, which composes a WorkoutStore count — cross-entity stays in the
// controller, not in a store).
func (s *FoodStore) DailyMacros(uid int64, date string) (models.DailyStats, error) {
	var stats models.DailyStats
	err := s.db.QueryRow(
		`SELECT COALESCE(SUM(calories),0), COALESCE(SUM(protein),0),
		        COALESCE(SUM(carbs),0), COALESCE(SUM(fat),0), COALESCE(SUM(fiber),0),
		        COALESCE(SUM(sodium),0), COALESCE(SUM(cholesterol),0)
		 FROM food_logs WHERE user_id = ? AND substr(logged_at, 1, 10) = ?`,
		uid, date,
	).Scan(&stats.TotalCalories, &stats.TotalProtein, &stats.TotalCarbs, &stats.TotalFat, &stats.TotalFiber,
		&stats.TotalSodium, &stats.TotalCholesterol)
	return stats, err
}

// RecentFoodNames returns up to limit distinct food names the user logged,
// most recently logged first — used as an implicit taste signal for the meal
// recommender.
func (s *FoodStore) RecentFoodNames(uid int64, limit int) ([]string, error) {
	rows, err := s.db.Query(
		`SELECT name FROM food_logs WHERE user_id = ?
		 GROUP BY name ORDER BY MAX(logged_at) DESC LIMIT ?`,
		uid, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	names := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		names = append(names, n)
	}
	return names, rows.Err()
}

// foodNameKey normalizes a food name/brand column into a grouping key:
// lowercased, internal whitespace runs collapsed, then trimmed. Without this,
// entries that are indistinguishable on screen ("Eggs", "eggs", "Eggs ")
// become separate rows in the Recent list.
func foodNameKey(col string) string {
	e := fmt.Sprintf("replace(replace(lower(%s), char(9), ' '), char(10), ' ')", col)
	// Three passes collapse runs of up to 8 spaces — far beyond any real label.
	for range 3 {
		e = fmt.Sprintf("replace(%s, '  ', ' ')", e)
	}
	return "trim(" + e + ")"
}

// RecentFrequentFoods returns the user's go-to foods within the last sinceDays:
// one row per distinct food (its most-recent logged entry, via SQLite's "bare
// column follows the max() row" rule) plus how many times it was logged, ranked
// most-used first (log_count DESC) with the most recently logged breaking ties.
// Over a short window this showcases the items logged most often and most
// recently — e.g. a daily coffee — at the top. Backed by idx_food_logs_user.
//
// "Distinct food" is keyed on the normalized name alone — deliberately not on
// brand. The same food reaches food_logs by several routes (barcode scan, AI
// label, search, hand entry) that disagree about brand, so keying on it split
// rows the user sees as identical: two "Eggs", same macros, one with an empty
// brand. Since the row already shows only the latest entry's macros, collapsing
// by name is the same trade the query was already making.
func (s *FoodStore) RecentFrequentFoods(uid int64, sinceDays, limit int) ([]models.RecentFood, error) {
	rows, err := s.db.Query(
		// The MAX(logged_at) column makes it the query's single min/max aggregate,
		// so every bare column (macros, servings, logged_at, etc.) resolves to the
		// row with the most-recent logged_at — i.e. the food's latest logged entry.
		// logged_at is kept as a bare column (not MAX) so it retains DATETIME
		// affinity and scans into time.Time; last_logged is a throwaway that only
		// exists to trigger the rule.
		`SELECT id, user_id, name, brand, meal, calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol, servings, serving_size, serving_size_grams, barcode, image_url, source, logged_at, created_at, COUNT(*) AS log_count, MAX(logged_at) AS last_logged
		 FROM food_logs
		 WHERE user_id = ? AND logged_at >= date('now', ?)
		 GROUP BY `+foodNameKey("name")+`
		 ORDER BY COUNT(*) DESC, MAX(logged_at) DESC
		 LIMIT ?`,
		uid, dayWindow(sinceDays), limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	foods := []models.RecentFood{}
	for rows.Next() {
		var f models.RecentFood
		var lastLogged string // throwaway; only present to trigger the max()-row rule
		if err := rows.Scan(
			&f.ID, &f.UserID, &f.Name, &f.Brand, &f.Meal,
			&f.Calories, &f.Protein, &f.Carbs, &f.Fat, &f.Fiber, &f.Sugar, &f.Sodium, &f.Cholesterol,
			&f.Servings, &f.ServingSize, &f.ServingSizeGrams, &f.Barcode, &f.ImageURL, &f.Source,
			&f.LoggedAt, &f.CreatedAt, &f.LogCount, &lastLogged,
		); err != nil {
			return nil, err
		}
		foods = append(foods, f)
	}
	return foods, rows.Err()
}

func (s *FoodStore) History(uid int64, days int) ([]models.FoodHistoryPoint, error) {
	rows, err := s.db.Query(
		`SELECT substr(logged_at, 1, 10) as d,
		        COALESCE(SUM(calories),0), COALESCE(SUM(protein),0),
		        COALESCE(SUM(carbs),0), COALESCE(SUM(fat),0)
		 FROM food_logs
		 WHERE user_id = ? AND logged_at >= date('now', ?)
		 GROUP BY d ORDER BY d ASC`,
		uid, dayWindow(days),
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	points := []models.FoodHistoryPoint{}
	for rows.Next() {
		var p models.FoodHistoryPoint
		if err := rows.Scan(&p.Date, &p.Calories, &p.Protein, &p.Carbs, &p.Fat); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

// LoggedDaysCount returns how many distinct calendar days in the last `days`
// days (today inclusive) have at least one food_logs entry — the
// logging-consistency signal for the weight-plan adherence panel. The result is
// therefore always <= days, so callers can safely render it as "n of days".
func (s *FoodStore) LoggedDaysCount(uid int64, days int) (int, error) {
	var n int
	err := s.db.QueryRow(
		`SELECT COUNT(DISTINCT substr(logged_at, 1, 10)) FROM food_logs
		 WHERE user_id = ? AND logged_at >= date('now', ?)`,
		uid, dayWindow(days),
	).Scan(&n)
	return n, err
}

const savedFoodSelect = `SELECT id, user_id, name, brand, calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol, serving_size, serving_size_grams, barcode, image_url, created_at FROM saved_foods`

func scanSavedFood(row interface{ Scan(...any) error }, f *models.SavedFood) error {
	return row.Scan(&f.ID, &f.UserID, &f.Name, &f.Brand, &f.Calories, &f.Protein, &f.Carbs, &f.Fat,
		&f.Fiber, &f.Sugar, &f.Sodium, &f.Cholesterol, &f.ServingSize, &f.ServingSizeGrams, &f.Barcode, &f.ImageURL, &f.CreatedAt)
}

func (s *FoodStore) ListSaved(uid int64) ([]models.SavedFood, error) {
	// LIMIT is a backstop, not pagination — the UI shows the full saved list,
	// but an unbounded query over a years-old account shouldn't be possible.
	rows, err := s.db.Query(savedFoodSelect+` WHERE user_id = ? ORDER BY name ASC LIMIT 500`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	foods := []models.SavedFood{}
	for rows.Next() {
		var f models.SavedFood
		if err := scanSavedFood(rows, &f); err != nil {
			return nil, err
		}
		foods = append(foods, f)
	}
	return foods, rows.Err()
}

func (s *FoodStore) CreateSaved(uid int64, req models.SaveFoodRequest) (models.SavedFood, error) {
	res, err := s.db.Exec(
		`INSERT INTO saved_foods (user_id, name, brand, calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol, serving_size, serving_size_grams, barcode, image_url)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		uid, req.Name, req.Brand, req.Calories, req.Protein, req.Carbs, req.Fat, req.Fiber, req.Sugar, req.Sodium, req.Cholesterol,
		req.ServingSize, req.ServingSizeGrams, req.Barcode, req.ImageURL,
	)
	if err != nil {
		return models.SavedFood{}, err
	}
	id, _ := res.LastInsertId()
	var f models.SavedFood
	err = scanSavedFood(s.db.QueryRow(savedFoodSelect+` WHERE id = ?`, id), &f)
	return f, err
}

func (s *FoodStore) GetSaved(uid, id int64) (models.SavedFood, error) {
	var f models.SavedFood
	err := scanSavedFood(s.db.QueryRow(savedFoodSelect+` WHERE id = ? AND user_id = ?`, id, uid), &f)
	return f, err
}

func (s *FoodStore) UpdateSaved(uid, id int64, req models.UpdateSavedFoodRequest) (models.SavedFood, error) {
	res, err := s.db.Exec(
		`UPDATE saved_foods SET name=?, brand=?, calories=?, protein=?, carbs=?, fat=?, fiber=?, sugar=?, sodium=?, cholesterol=?,
		 serving_size=?, serving_size_grams=?, barcode=?, image_url=?
		 WHERE id=? AND user_id=?`,
		req.Name, req.Brand, req.Calories, req.Protein, req.Carbs, req.Fat, req.Fiber, req.Sugar, req.Sodium, req.Cholesterol,
		req.ServingSize, req.ServingSizeGrams, req.Barcode, req.ImageURL,
		id, uid,
	)
	if err != nil {
		return models.SavedFood{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return models.SavedFood{}, sql.ErrNoRows
	}
	return s.GetSaved(uid, id)
}

func (s *FoodStore) DeleteSaved(uid, id int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM saved_foods WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		return 0, err
	}
	n, _ := res.RowsAffected()
	return n, nil
}
