package stores

import (
	"database/sql"
	"encoding/json"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// FoodProductStore owns all SQL for food_products: resolved barcode lookups
// cached by 14-digit GTIN, so a repeat scan of a staple doesn't need a network
// round trip and still works when the upstream databases are slow or down.
//
// The cached value is the normalized search result rather than either
// upstream's raw payload — the merge decision (which source won, and why) is
// made once at lookup time and doesn't need re-deciding on every cache hit.
type FoodProductStore struct{ db *sql.DB }

func NewFoodProductStore(db *sql.DB) *FoodProductStore { return &FoodProductStore{db: db} }

// Get returns the cached product for a GTIN along with when it was fetched, or
// sql.ErrNoRows if the barcode has never been resolved. Freshness is the
// caller's call: it knows the TTL it wants and whether a stale row still beats
// no answer at all.
func (s *FoodProductStore) Get(gtin string) (models.FoodSearchResult, time.Time, error) {
	var (
		payload   string
		fetchedAt time.Time
		r         models.FoodSearchResult
	)
	err := s.db.QueryRow(
		`SELECT payload, fetched_at FROM food_products WHERE gtin = ?`, gtin,
	).Scan(&payload, &fetchedAt)
	if err != nil {
		return r, time.Time{}, err
	}
	if err := json.Unmarshal([]byte(payload), &r); err != nil {
		return models.FoodSearchResult{}, time.Time{}, err
	}
	return r, fetchedAt, nil
}

// Upsert caches a resolved product, replacing any previous entry for the GTIN
// and resetting its age.
func (s *FoodProductStore) Upsert(gtin string, r models.FoodSearchResult) error {
	payload, err := json.Marshal(r)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(
		`INSERT INTO food_products (gtin, payload, source, fetched_at) VALUES (?, ?, ?, ?)
		 ON CONFLICT(gtin) DO UPDATE SET
		   payload    = excluded.payload,
		   source     = excluded.source,
		   fetched_at = excluded.fetched_at`,
		gtin, string(payload), r.Source, time.Now(),
	)
	return err
}
