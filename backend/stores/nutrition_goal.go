package stores

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/models"
)

// NutritionGoalStore owns all SQL for the append-only nutrition_goals history
// and its weight_plan_projections. Rows are never UPDATEd — the "current"
// goal is the latest row by effective_at.
type NutritionGoalStore struct{ db *sql.DB }

func NewNutritionGoalStore(db *sql.DB) *NutritionGoalStore { return &NutritionGoalStore{db: db} }

const nutritionGoalSelect = `SELECT id, user_id, calorie_target, protein_target, carb_target, fat_target, target_weight, source, notes, effective_at, created_at FROM nutrition_goals`

func scanNutritionGoal(row interface{ Scan(...any) error }, g *models.NutritionGoal) error {
	return row.Scan(&g.ID, &g.UserID, &g.CalorieTarget, &g.ProteinTarget, &g.CarbTarget, &g.FatTarget,
		&g.TargetWeight, &g.Source, &g.Notes, &g.EffectiveAt, &g.CreatedAt)
}

// Current returns the user's latest nutrition goal, or sql.ErrNoRows if
// they've never accepted a plan.
func (s *NutritionGoalStore) Current(uid int64) (models.NutritionGoal, error) {
	var g models.NutritionGoal
	err := scanNutritionGoal(s.db.QueryRow(nutritionGoalSelect+` WHERE user_id = ? ORDER BY effective_at DESC, id DESC LIMIT 1`, uid), &g)
	return g, err
}

// List returns the user's nutrition-goal history, most recent first.
func (s *NutritionGoalStore) List(uid int64, limit int) ([]models.NutritionGoal, error) {
	rows, err := s.db.Query(nutritionGoalSelect+` WHERE user_id = ? ORDER BY effective_at DESC, id DESC LIMIT ?`, uid, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	goals := []models.NutritionGoal{}
	for rows.Next() {
		var g models.NutritionGoal
		if err := scanNutritionGoal(rows, &g); err != nil {
			return nil, err
		}
		goals = append(goals, g)
	}
	return goals, rows.Err()
}

// ListProjections returns the weekly trajectory tied to one nutrition goal,
// ordered by week.
func (s *NutritionGoalStore) ListProjections(goalID int64) ([]models.WeightPlanProjectionPoint, error) {
	rows, err := s.db.Query(
		`SELECT id, nutrition_goal_id, week, expected_weight, expected_date FROM weight_plan_projections WHERE nutrition_goal_id = ? ORDER BY week ASC`,
		goalID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	points := []models.WeightPlanProjectionPoint{}
	for rows.Next() {
		var p models.WeightPlanProjectionPoint
		if err := rows.Scan(&p.ID, &p.NutritionGoalID, &p.Week, &p.ExpectedWeight, &p.ExpectedDate); err != nil {
			return nil, err
		}
		points = append(points, p)
	}
	return points, rows.Err()
}

// Accept persists an accepted weight-loss plan atomically: inserts the goal
// row, bulk-inserts its weekly projections, and upserts the four macro
// targets into user_settings — all in one transaction. This store issues a
// narrow, explicitly-scoped upsert against user_settings (just the 4 macro
// columns) rather than calling UserStore.UpsertSettings, because two stores
// can't share one *sql.Tx in this codebase's current store design; this is
// the smallest safe extension of the inTx pattern rather than new cross-store
// transaction plumbing.
func (s *NutritionGoalStore) Accept(uid int64, goal models.NutritionGoal, projections []models.WeightPlanProjectionPoint) (models.NutritionGoal, error) {
	return inTx(s.db, func(tx *sql.Tx) (models.NutritionGoal, error) {
		var g models.NutritionGoal
		err := scanNutritionGoal(tx.QueryRow(
			`INSERT INTO nutrition_goals (user_id, calorie_target, protein_target, carb_target, fat_target, target_weight, source, notes)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?)
			 RETURNING id, user_id, calorie_target, protein_target, carb_target, fat_target, target_weight, source, notes, effective_at, created_at`,
			uid, goal.CalorieTarget, goal.ProteinTarget, goal.CarbTarget, goal.FatTarget, goal.TargetWeight, goal.Source, goal.Notes,
		), &g)
		if err != nil {
			return models.NutritionGoal{}, err
		}

		for _, p := range projections {
			if _, err := tx.Exec(
				`INSERT INTO weight_plan_projections (nutrition_goal_id, week, expected_weight, expected_date) VALUES (?, ?, ?, ?)`,
				g.ID, p.Week, p.ExpectedWeight, p.ExpectedDate,
			); err != nil {
				return models.NutritionGoal{}, err
			}
		}

		// INSERT ... ON CONFLICT rather than a plain UPDATE: a settings row
		// normally always exists (UserStore.Create seeds one atomically at
		// signup), but this stays correct even if that invariant is ever
		// broken, instead of silently no-oping.
		if _, err := tx.Exec(
			`INSERT INTO user_settings (user_id, calorie_target, protein_target, carb_target, fat_target)
			 VALUES (?, ?, ?, ?, ?)
			 ON CONFLICT(user_id) DO UPDATE SET
			   calorie_target = excluded.calorie_target,
			   protein_target = excluded.protein_target,
			   carb_target    = excluded.carb_target,
			   fat_target     = excluded.fat_target`,
			uid, g.CalorieTarget, g.ProteinTarget, g.CarbTarget, g.FatTarget,
		); err != nil {
			return models.NutritionGoal{}, err
		}

		return g, nil
	})
}
