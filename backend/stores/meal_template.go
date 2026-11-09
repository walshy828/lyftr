package stores

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// MealTemplateStore owns all SQL for meal_templates (saved meals).
type MealTemplateStore struct{ db *sql.DB }

func NewMealTemplateStore(db *sql.DB) *MealTemplateStore { return &MealTemplateStore{db: db} }

const mealTemplateSelect = `SELECT id, user_id, name, items, created_at, updated_at FROM meal_templates`

func scanMealTemplate(row interface{ Scan(...any) error }) (models.MealTemplate, error) {
	var t models.MealTemplate
	var items string
	if err := row.Scan(&t.ID, &t.UserID, &t.Name, &items, &t.CreatedAt, &t.UpdatedAt); err != nil {
		return t, err
	}
	if err := json.Unmarshal([]byte(items), &t.Items); err != nil {
		return t, err
	}
	if t.Items == nil {
		t.Items = []models.MealTemplateItem{}
	}
	return t, nil
}

func (s *MealTemplateStore) List(uid int64) ([]models.MealTemplate, error) {
	rows, err := s.db.Query(mealTemplateSelect+` WHERE user_id = ? ORDER BY updated_at DESC, id DESC`, uid)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.MealTemplate{}
	for rows.Next() {
		t, err := scanMealTemplate(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *MealTemplateStore) Get(uid, id int64) (models.MealTemplate, error) {
	return scanMealTemplate(s.db.QueryRow(mealTemplateSelect+` WHERE id = ? AND user_id = ?`, id, uid))
}

// CreateFromEntries snapshots the given (owned) food log entries into a new
// template. Ids the user doesn't own are skipped; zero usable entries is
// sql.ErrNoRows so the caller can answer 404 instead of saving an empty meal.
func (s *MealTemplateStore) CreateFromEntries(uid int64, name string, ids []int64) (models.MealTemplate, error) {
	return inTx(s.db, func(tx *sql.Tx) (models.MealTemplate, error) {
		placeholders, args := inArgs(ids)
		args = append([]any{uid}, args...)
		rows, err := tx.Query(foodLogSelect+` WHERE user_id = ? AND id IN (`+placeholders+`) ORDER BY logged_at ASC, id ASC`, args...)
		if err != nil {
			return models.MealTemplate{}, err
		}
		items := []models.MealTemplateItem{}
		for rows.Next() {
			var f models.FoodLog
			if err := scanFoodLog(rows, &f); err != nil {
				rows.Close()
				return models.MealTemplate{}, err
			}
			items = append(items, models.MealTemplateItem{
				Name: f.Name, Brand: f.Brand, Calories: f.Calories, Protein: f.Protein, Carbs: f.Carbs, Fat: f.Fat,
				Fiber: f.Fiber, Sugar: f.Sugar, Sodium: f.Sodium, Cholesterol: f.Cholesterol, Servings: f.Servings,
				ServingSize: f.ServingSize, ServingSizeGrams: f.ServingSizeGrams, ServingSizeML: f.ServingSizeML,
				Barcode: f.Barcode, ImageURL: f.ImageURL, Source: f.Source,
			})
		}
		if err := rows.Err(); err != nil {
			rows.Close()
			return models.MealTemplate{}, err
		}
		rows.Close()
		if len(items) == 0 {
			return models.MealTemplate{}, sql.ErrNoRows
		}
		raw, err := json.Marshal(items)
		if err != nil {
			return models.MealTemplate{}, err
		}
		res, err := tx.Exec(`INSERT INTO meal_templates (user_id, name, items) VALUES (?, ?, ?)`, uid, name, string(raw))
		if err != nil {
			return models.MealTemplate{}, err
		}
		id, _ := res.LastInsertId()
		return scanMealTemplate(tx.QueryRow(mealTemplateSelect+` WHERE id = ?`, id))
	})
}

func (s *MealTemplateStore) Rename(uid, id int64, name string) (models.MealTemplate, error) {
	res, err := s.db.Exec(`UPDATE meal_templates SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`, name, id, uid)
	if err != nil {
		return models.MealTemplate{}, err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return models.MealTemplate{}, sql.ErrNoRows
	}
	return s.Get(uid, id)
}

func (s *MealTemplateStore) Delete(uid, id int64) (int64, error) {
	res, err := s.db.Exec(`DELETE FROM meal_templates WHERE id = ? AND user_id = ?`, id, uid)
	if err != nil {
		return 0, err
	}
	return res.RowsAffected()
}

// Log writes every item of the template as a food log entry at loggedAt/meal,
// and bumps the template's updated_at so the most-used meals sort first.
func (s *MealTemplateStore) Log(uid, id int64, loggedAt time.Time, meal string) ([]models.FoodLog, error) {
	return inTx(s.db, func(tx *sql.Tx) ([]models.FoodLog, error) {
		t, err := scanMealTemplate(tx.QueryRow(mealTemplateSelect+` WHERE id = ? AND user_id = ?`, id, uid))
		if err != nil {
			return nil, err
		}
		out := make([]models.FoodLog, 0, len(t.Items))
		for _, it := range t.Items {
			res, err := tx.Exec(
				`INSERT INTO food_logs (user_id, name, brand, meal, calories, protein, carbs, fat, fiber, sugar, sodium, cholesterol, servings, serving_size, serving_size_grams, serving_size_ml, barcode, image_url, source, logged_at)
				 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
				uid, it.Name, it.Brand, meal, it.Calories, it.Protein, it.Carbs, it.Fat, it.Fiber, it.Sugar, it.Sodium, it.Cholesterol,
				it.Servings, it.ServingSize, it.ServingSizeGrams, it.ServingSizeML, it.Barcode, it.ImageURL, it.Source, loggedAt,
			)
			if err != nil {
				return nil, err
			}
			lid, _ := res.LastInsertId()
			var f models.FoodLog
			if err := scanFoodLog(tx.QueryRow(foodLogSelect+` WHERE id = ?`, lid), &f); err != nil {
				return nil, err
			}
			out = append(out, f)
		}
		if _, err := tx.Exec(`UPDATE meal_templates SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`, id); err != nil {
			return nil, err
		}
		return out, nil
	})
}
