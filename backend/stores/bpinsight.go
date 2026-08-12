package stores

import (
	"database/sql"

	"github.com/Cawlumm/lyftr-backend/models"
)

// bpInsightHistoryLimit is how many runs are kept per user, matching
// checkinHistoryLimit for the same reason: an insight is a point-in-time
// report, the page only shows the latest, and unbounded growth would just
// accumulate multi-KB JSON blobs.
const bpInsightHistoryLimit = 12

// BPInsightStore owns all SQL for bp_insights: persisted blood-pressure
// insight runs (computed facts + whatever narrative the AI produced from them).
//
// Unlike plan_checkins there is no goal_id — blood pressure is tracked
// independently of any weight plan, and requiring one would make the feature
// unavailable to anyone who hasn't set a weight goal.
type BPInsightStore struct{ db *sql.DB }

func NewBPInsightStore(db *sql.DB) *BPInsightStore { return &BPInsightStore{db: db} }

const bpInsightSelect = `SELECT id, user_id, facts, report, created_at FROM bp_insights`

func scanBPInsight(row interface{ Scan(...any) error }) (models.BPInsight, error) {
	var i models.BPInsight
	err := row.Scan(&i.ID, &i.UserID, &i.FactsJSON, &i.ReportJSON, &i.CreatedAt)
	return i, err
}

// Latest returns the user's most recent insight, or sql.ErrNoRows if they have
// never run one.
func (s *BPInsightStore) Latest(uid int64) (models.BPInsight, error) {
	return scanBPInsight(s.db.QueryRow(
		bpInsightSelect+` WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT 1`, uid))
}

// Insert stores a run and prunes the user's history back to
// bpInsightHistoryLimit. Both statements run in one transaction so a reader can
// never observe the pruned-but-not-yet-inserted state.
func (s *BPInsightStore) Insert(uid int64, facts, report string) (models.BPInsight, error) {
	return inTx(s.db, func(tx *sql.Tx) (models.BPInsight, error) {
		i, err := scanBPInsight(tx.QueryRow(
			`INSERT INTO bp_insights (user_id, facts, report) VALUES (?, ?, ?)
			 RETURNING id, user_id, facts, report, created_at`,
			uid, facts, report))
		if err != nil {
			return i, err
		}
		_, err = tx.Exec(
			`DELETE FROM bp_insights WHERE user_id = ? AND id NOT IN (
			   SELECT id FROM bp_insights WHERE user_id = ? ORDER BY created_at DESC, id DESC LIMIT ?
			 )`, uid, uid, bpInsightHistoryLimit)
		return i, err
	})
}
