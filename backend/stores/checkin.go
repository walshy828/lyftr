package stores

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/models"
)

// checkinHistoryLimit is how many runs are kept per user. A check-in is a
// point-in-time report, not a log — the page only ever shows the latest, and
// the older ones exist so a future "compare to last time" view has something
// to read. Unbounded growth would just accumulate multi-KB JSON blobs.
const checkinHistoryLimit = 12

// CheckinStore owns all SQL for plan_checkins: persisted progress check-in
// runs (computed facts + the AI narrative generated from them).
type CheckinStore struct{ db *sql.DB }

func NewCheckinStore(db *sql.DB) *CheckinStore { return &CheckinStore{db: db} }

const checkinSelect = `SELECT id, user_id, goal_id, facts, report, created_at FROM plan_checkins`

func scanCheckin(row interface{ Scan(...any) error }) (models.PlanCheckin, error) {
	var c models.PlanCheckin
	err := row.Scan(&c.ID, &c.UserID, &c.GoalID, &c.FactsJSON, &c.ReportJSON, &c.CreatedAt)
	return c, err
}

// Latest returns the user's most recent check-in, or sql.ErrNoRows if they
// have never run one.
func (s *CheckinStore) Latest(uid int64) (models.PlanCheckin, error) {
	return scanCheckin(s.db.QueryRow(
		checkinSelect+` WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`, uid))
}

// Insert stores a run and prunes the user's history back to
// checkinHistoryLimit. Both statements run in one transaction so a reader can
// never observe the pruned-but-not-yet-inserted state.
func (s *CheckinStore) Insert(uid, goalID int64, facts, report string) (models.PlanCheckin, error) {
	return inTx(s.db, func(tx *sql.Tx) (models.PlanCheckin, error) {
		c, err := scanCheckin(tx.QueryRow(
			`INSERT INTO plan_checkins (user_id, goal_id, facts, report) VALUES (?, ?, ?, ?)
			 RETURNING id, user_id, goal_id, facts, report, created_at`,
			uid, goalID, facts, report))
		if err != nil {
			return c, err
		}
		_, err = tx.Exec(
			`DELETE FROM plan_checkins WHERE user_id = ? AND id NOT IN (
			   SELECT id FROM plan_checkins WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
			 )`, uid, uid, checkinHistoryLimit)
		return c, err
	})
}
