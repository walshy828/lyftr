package controllers

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/Cawlumm/lyftr-backend/config"
	"github.com/Cawlumm/lyftr-backend/middleware"
	"github.com/Cawlumm/lyftr-backend/models"
	"github.com/Cawlumm/lyftr-backend/storage"
	"github.com/Cawlumm/lyftr-backend/utils"
	"github.com/Cawlumm/lyftr-backend/vision"
	"github.com/gin-gonic/gin"
)

// maxLabelImageBytes caps the base64-encoded image payload accepted by
// AnalyzeFoodLabel — roughly a ~4MB raw image after base64's ~4/3 inflation,
// comfortably above a client-side-downscaled (~1600px) JPEG.
const maxLabelImageBytes = 5_600_000

var offClient = &http.Client{Timeout: 5 * time.Second}

const offUserAgent = "Lyftr/1.0 (https://lyftr.app; nutrition-tracker)"

func (h *Handler) ListFoodLogs(c *gin.Context) {
	uid := middleware.UserID(c)

	date := c.Query("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	logs, err := h.s.Food.ListByDay(uid, date)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, logs)
}

// ListRecentFoods returns the user's frequently-used foods (most-recent entry
// per distinct food, ranked most-used-first over the last 7 days) — powers the
// Log Food "Recent" tab.
func (h *Handler) ListRecentFoods(c *gin.Context) {
	uid := middleware.UserID(c)

	foods, err := h.s.Food.RecentFrequentFoods(uid, 7, 20)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, foods)
}

func (h *Handler) GetFoodLog(c *gin.Context) {
	uid := middleware.UserID(c)
	lid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	f, err := h.s.Food.Get(uid, lid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "log entry not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, f)
}

func (h *Handler) LogFood(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.LogFoodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if len(req.Name) > 200 {
		utils.BadRequest(c, "name exceeds 200 characters")
		return
	}
	if len(req.ServingSize) > 100 {
		utils.BadRequest(c, "serving_size exceeds 100 characters")
		return
	}
	if len(req.Barcode) > 50 {
		utils.BadRequest(c, "barcode exceeds 50 characters")
		return
	}
	// Data URL base64 image strings can be very large; cap them at 10MB to match typical payloads.
	if len(req.ImageURL) > 10_000_000 {
		utils.BadRequest(c, "image_url exceeds size limit")
		return
	}

	if req.LoggedAt.IsZero() {
		req.LoggedAt = time.Now()
	}
	if req.Servings == 0 {
		req.Servings = 1
	}

	f, err := h.s.Food.Create(uid, req)
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, f)
}

func (h *Handler) UpdateFoodLog(c *gin.Context) {
	uid := middleware.UserID(c)
	lid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	var req models.LogFoodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if len(req.Name) > 200 {
		utils.BadRequest(c, "name exceeds 200 characters")
		return
	}
	if len(req.ServingSize) > 100 {
		utils.BadRequest(c, "serving_size exceeds 100 characters")
		return
	}
	if len(req.Barcode) > 50 {
		utils.BadRequest(c, "barcode exceeds 50 characters")
		return
	}
	if len(req.ImageURL) > 10_000_000 {
		utils.BadRequest(c, "image_url exceeds size limit")
		return
	}
	if req.Servings == 0 {
		req.Servings = 1
	}

	f, err := h.s.Food.Update(uid, lid, req)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "log entry not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, f)
}

// mealPhotoURLPrefix identifies a FoodLog.ImageURL that points at a locally
// persisted meal photo (served by ServeMealPhoto) rather than an external
// URL (e.g. Open Food Facts), so DeleteFoodLog knows when it also needs to
// remove a file from disk.
const mealPhotoURLPrefix = "/api/v1/food/photos/"

func (h *Handler) DeleteFoodLog(c *gin.Context) {
	uid := middleware.UserID(c)
	lid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	// Look up the entry first so a locally-stored meal photo can be cleaned
	// up from disk — best-effort, since a self-hosted single-file-DB app
	// shouldn't fail the delete over an orphaned file.
	f, err := h.s.Food.Get(uid, lid)
	if err != nil && err != sql.ErrNoRows {
		if utils.DBError(c, err) {
			return
		}
	}

	n, err := h.s.Food.Delete(uid, lid)
	if utils.DBError(c, err) {
		return
	}
	if n == 0 {
		utils.NotFound(c, "log entry not found")
		return
	}

	if strings.HasPrefix(f.ImageURL, mealPhotoURLPrefix) {
		relPath := strings.TrimPrefix(f.ImageURL, mealPhotoURLPrefix) // "{userID}/{filename}"
		if err := storage.DeleteUserPhoto(config.C.MealPhotoDir, uid, relPath); err != nil {
			log.Printf("[food/:id delete] photo cleanup error: %v", err)
		}
	}

	utils.OK(c, gin.H{"deleted": true})
}

func (h *Handler) GetDailyStats(c *gin.Context) {
	uid := middleware.UserID(c)
	date := c.Query("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	stats, err := h.s.Food.DailyMacros(uid, date)
	if utils.DBError(c, err) {
		return
	}
	stats.Date = date
	if stats.WorkoutCount, err = h.s.Workout.CountOn(uid, date); utils.DBError(c, err) {
		return
	}
	utils.OK(c, stats)
}

func (h *Handler) GetFoodHistory(c *gin.Context) {
	uid := middleware.UserID(c)

	days := 30
	if d, err := strconv.Atoi(c.Query("days")); err == nil && d > 0 && d <= 365 {
		days = d
	}

	points, err := h.s.Food.History(uid, days)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, points)
}

// ─── Open Food Facts proxy ────────────────────────────────────────────────────

// offSearchResponse is a partial decode of the OFF search API response.
type offSearchResponse struct {
	Products []offProduct `json:"products"` // CGI endpoint
	Hits     []offProduct `json:"hits"`     // new search endpoint
}

// offBrands accepts both a JSON string and a JSON array of strings.
type offBrands []string

func (b *offBrands) UnmarshalJSON(data []byte) error {
	if len(data) == 0 || string(data) == "null" {
		return nil
	}
	if data[0] == '[' {
		var arr []string
		if err := json.Unmarshal(data, &arr); err != nil {
			return err
		}
		*b = arr
		return nil
	}
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	if s != "" {
		*b = []string{s}
	}
	return nil
}

type offProduct struct {
	ProductName string       `json:"product_name"`
	Brands      offBrands    `json:"brands"`
	Nutriments  offNutrients `json:"nutriments"`
	ServingSize string       `json:"serving_size"`
	ImageURL    string       `json:"image_url"`
}

type offNutrients struct {
	EnergyKcal100g    float64 `json:"energy-kcal_100g"`
	Proteins100g      float64 `json:"proteins_100g"`
	Carbohydrates100g float64 `json:"carbohydrates_100g"`
	Fat100g           float64 `json:"fat_100g"`
	Fiber100g         float64 `json:"fiber_100g"`
	Sugars100g        float64 `json:"sugars_100g"`
	Sodium100g        float64 `json:"sodium_100g"`      // grams, per OFF convention
	Cholesterol100g   float64 `json:"cholesterol_100g"` // grams, per OFF convention

	EnergyKcalServing    float64 `json:"energy-kcal_serving"`
	ProteinsServing      float64 `json:"proteins_serving"`
	CarbohydratesServing float64 `json:"carbohydrates_serving"`
	FatServing           float64 `json:"fat_serving"`
	FiberServing         float64 `json:"fiber_serving"`
	SugarsServing        float64 `json:"sugars_serving"`
	SodiumServing        float64 `json:"sodium_serving"`      // grams, per OFF convention
	CholesterolServing   float64 `json:"cholesterol_serving"` // grams, per OFF convention
}

// offGramsToMg converts an OFF nutrient value, normalized in grams per its
// convention, to the milligrams unit the rest of the app uses for sodium and
// cholesterol.
func offGramsToMg(grams float64) float64 { return grams * 1000 }

func offProductToResult(p offProduct) models.FoodSearchResult {
	brand := strings.Join(p.Brands, ", ")
	imageURL := p.ImageURL
	if !strings.HasPrefix(imageURL, "https://") {
		imageURL = ""
	}

	// Prefer per-serving values when OFF provides them and a serving size label.
	// Fall back to per-100g so the label always matches the numbers.
	useServing := p.Nutriments.EnergyKcalServing > 0 && strings.TrimSpace(p.ServingSize) != ""
	var cal, pro, carb, fat, fiber, sugar, sodium, cholesterol float64
	var servingLabel string
	var servingGrams float64
	var portions []models.FoodPortion
	if useServing {
		cal = p.Nutriments.EnergyKcalServing
		pro = p.Nutriments.ProteinsServing
		carb = p.Nutriments.CarbohydratesServing
		fat = p.Nutriments.FatServing
		fiber = p.Nutriments.FiberServing
		sugar = p.Nutriments.SugarsServing
		sodium = offGramsToMg(p.Nutriments.SodiumServing)
		cholesterol = offGramsToMg(p.Nutriments.CholesterolServing)
		servingLabel = p.ServingSize
		// OFF serving_size is free text ("30 g (2 tbsp)"). Recover a gram basis
		// where we can, and surface the household measure it names — that's the
		// only portion data OFF carries.
		mass, measure := parseServingMass(p.ServingSize)
		servingGrams = mass
		if measure != "" && mass > 0 {
			portions = append(portions, models.FoodPortion{Label: measure, Grams: mass})
		}
	} else {
		cal = p.Nutriments.EnergyKcal100g
		pro = p.Nutriments.Proteins100g
		carb = p.Nutriments.Carbohydrates100g
		fat = p.Nutriments.Fat100g
		fiber = p.Nutriments.Fiber100g
		sugar = p.Nutriments.Sugars100g
		sodium = offGramsToMg(p.Nutriments.Sodium100g)
		cholesterol = offGramsToMg(p.Nutriments.Cholesterol100g)
		servingLabel = "per 100g"
		servingGrams = 100
		// The label OFF couldn't attach to per-serving numbers may still name a
		// mass we can offer as a portion — e.g. "15 g" on a condiment.
		if mass, _ := parseServingMass(p.ServingSize); mass > 0 {
			portions = append(portions, models.FoodPortion{Label: strings.TrimSpace(p.ServingSize), Grams: mass})
		}
	}

	return models.FoodSearchResult{
		Name:             p.ProductName,
		Brand:            brand,
		Calories:         cal,
		Protein:          pro,
		Carbs:            carb,
		Fat:              fat,
		Fiber:            fiber,
		Sugar:            sugar,
		Sodium:           sodium,
		Cholesterol:      cholesterol,
		ServingSize:      servingLabel,
		ServingSizeGrams: servingGrams,
		Portions:         portions,
		ImageURL:         imageURL,
		Source:           "off",
	}
}

func doOFFRequest(ctx context.Context, rawURL string) ([]byte, int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, 0, err
	}
	req.Header.Set("User-Agent", offUserAgent)

	resp, err := offClient.Do(req)
	if err != nil {
		return nil, 0, err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4 MB limit
	return body, resp.StatusCode, err
}

func (h *Handler) SearchFood(c *gin.Context) {
	q := c.Query("q")
	if q == "" {
		utils.BadRequest(c, "q is required")
		return
	}

	limit := 20
	if l, err := strconv.Atoi(c.Query("limit")); err == nil && l > 0 && l <= 50 {
		limit = l
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	// Fan out to both sources concurrently under the one timeout. Either source
	// alone is enough to answer: OFF covers barcoded packaged goods, FDC covers
	// generic whole foods, and a user searching "chicken breast" should not get
	// an error page because the packaged-goods index was down.
	fdcKey := ""
	if config.C != nil {
		fdcKey = config.C.FDCAPIKey
	}

	var (
		wg         sync.WaitGroup
		offResults []models.FoodSearchResult
		offErr     error
		offStatus  int
		fdcResults []models.FoodSearchResult
		fdcErr     error
	)

	wg.Add(1)
	go func() {
		defer wg.Done()
		offResults, offStatus, offErr = searchOFF(ctx, q, limit)
	}()

	if fdcKey != "" {
		wg.Add(1)
		go func() {
			defer wg.Done()
			start := time.Now()
			fdcResults, fdcErr = searchFDC(ctx, fdcKey, q, limit)
			log.Printf("[food/search] FDC response: results=%d duration=%dms err=%v",
				len(fdcResults), time.Since(start).Milliseconds(), fdcErr)
		}()
	}
	wg.Wait()

	// Only surface a failure when neither source produced anything.
	if len(offResults) == 0 && len(fdcResults) == 0 {
		switch {
		case offErr != nil && ctx.Err() == context.DeadlineExceeded:
			utils.ServiceUnavailable(c, "food search timed out — try again")
		case offStatus == 429:
			c.Header("Retry-After", "60")
			c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many requests — wait a moment and try again"})
		case offErr != nil:
			utils.ServiceUnavailable(c, "could not reach food database")
		case fdcErr != nil && fdcKey != "":
			utils.ServiceUnavailable(c, "food search temporarily unavailable")
		default:
			utils.OK(c, []models.FoodSearchResult{})
		}
		return
	}

	utils.OK(c, mergeSearchResults(q, offResults, fdcResults, limit))
}

// searchOFF runs the Open Food Facts leg of a search. The HTTP status is
// returned alongside the error so the caller can preserve OFF's rate-limit
// signalling when it's the only source that ran.
func searchOFF(ctx context.Context, q string, limit int) ([]models.FoodSearchResult, int, error) {
	start := time.Now()
	searchURL := fmt.Sprintf(
		"https://search.openfoodfacts.org/search?q=%s&lang=en&cc=world&page_size=%d&page=1&fields=product_name,brands,nutriments,serving_size,image_url",
		url.QueryEscape(q), limit,
	)
	// The query itself is not logged: it's a record of what the user eats, and
	// container logs are routinely shipped to aggregators. Length is enough to
	// correlate a request with its response for debugging.
	log.Printf("[food/search] OFF request: qlen=%d limit=%d", len(q), limit)

	body, status, err := doOFFRequest(ctx, searchURL)
	elapsed := time.Since(start)
	log.Printf("[food/search] OFF response: status=%d duration=%dms", status, elapsed.Milliseconds())

	if err != nil {
		log.Printf("[food/search] OFF network error: %v", err)
		return nil, status, err
	}
	if status != http.StatusOK {
		log.Printf("[food/search] OFF upstream status: %d", status)
		return nil, status, fmt.Errorf("off: unexpected status %d", status)
	}

	var parsed offSearchResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		log.Printf("[food/search] OFF parse error: %v", err)
		return nil, status, err
	}

	products := parsed.Hits
	if len(products) == 0 {
		products = parsed.Products // fallback for CGI-style response
	}
	results := make([]models.FoodSearchResult, 0, len(products))
	for _, p := range products {
		if p.ProductName == "" {
			continue
		}
		results = append(results, offProductToResult(p))
	}
	return results, status, nil
}

// mergeSearchResults dedupes across sources and interleaves them, so neither
// OFF's branded products nor FDC's generic entries monopolize the top of the
// list — the user's query alone rarely says which of the two they meant.
// Within each source, results keep their relevance order but are stably
// re-sorted so closer name matches float up.
func mergeSearchResults(query string, off, fdc []models.FoodSearchResult, limit int) []models.FoodSearchResult {
	off = rankByQuery(query, off)
	fdc = rankByQuery(query, fdc)

	merged := make([]models.FoodSearchResult, 0, len(off)+len(fdc))
	seen := map[string]bool{}
	add := func(r models.FoodSearchResult) bool {
		key := normalizeFoodName(r.Name) + "|" + normalizeFoodName(r.Brand)
		if seen[key] {
			return false
		}
		seen[key] = true
		merged = append(merged, r)
		return true
	}

	for i := 0; i < len(off) || i < len(fdc); i++ {
		if i < len(off) {
			add(off[i])
		}
		if i < len(fdc) {
			add(fdc[i])
		}
	}

	if len(merged) > limit {
		merged = merged[:limit]
	}
	return merged
}

// rankByQuery stably re-sorts results by how directly the name answers the
// query: exact match, then prefix, then substring, then everything else.
func rankByQuery(query string, results []models.FoodSearchResult) []models.FoodSearchResult {
	q := normalizeFoodName(query)
	if q == "" || len(results) < 2 {
		return results
	}
	score := func(r models.FoodSearchResult) int {
		name := normalizeFoodName(r.Name)
		switch {
		case name == q:
			return 0
		case strings.HasPrefix(name, q):
			return 1
		case strings.Contains(name, q):
			return 2
		default:
			return 3
		}
	}
	sorted := make([]models.FoodSearchResult, len(results))
	copy(sorted, results)
	sort.SliceStable(sorted, func(i, j int) bool { return score(sorted[i]) < score(sorted[j]) })
	return sorted
}

// offBarcodeResponse is a partial decode of the OFF v3 product endpoint.
type offBarcodeResponse struct {
	Status  string     `json:"status"` // v3 API returns "success" | "failure"
	Product offProduct `json:"product"`
}

func (h *Handler) LookupBarcode(c *gin.Context) {
	code := c.Param("code")
	if code == "" {
		utils.BadRequest(c, "barcode is required")
		return
	}

	matched, err := regexp.MatchString(`^\d{6,14}$`, code)
	if err != nil || !matched {
		utils.BadRequest(c, "Invalid barcode format")
		return
	}

	start := time.Now()
	lookupURL := fmt.Sprintf("https://world.openfoodfacts.org/api/v3/product/%s.json", url.PathEscape(code))
	// The scanned barcode identifies a specific product the user is eating —
	// dietary data, not diagnostics. See the note in the search handler.
	log.Printf("[food/barcode] OFF request")

	ctx, cancel := context.WithTimeout(c.Request.Context(), 5*time.Second)
	defer cancel()

	body, status, err := doOFFRequest(ctx, lookupURL)
	elapsed := time.Since(start)
	log.Printf("[food/barcode] OFF response: status=%d duration=%dms", status, elapsed.Milliseconds())

	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			log.Printf("[food/barcode] OFF timeout after %dms", elapsed.Milliseconds())
			utils.ServiceUnavailable(c, "barcode lookup timed out — try again")
			return
		}
		log.Printf("[food/barcode] OFF network error: %v", err)
		utils.ServiceUnavailable(c, "could not reach food database")
		return
	}

	switch {
	case status == 429:
		log.Printf("[food/barcode] OFF rate limit hit")
		c.Header("Retry-After", "60")
		c.JSON(http.StatusTooManyRequests, gin.H{"error": "too many requests — wait a moment and try again"})
		return
	case status >= 500:
		log.Printf("[food/barcode] OFF upstream error: %d", status)
		utils.ServiceUnavailable(c, "barcode lookup temporarily unavailable")
		return
	}

	var parsed offBarcodeResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		log.Printf("[food/barcode] OFF parse error: %v", err)
		utils.InternalError(c)
		return
	}

	if !strings.HasPrefix(parsed.Status, "success") || parsed.Product.ProductName == "" {
		utils.NotFound(c, "product not found")
		return
	}

	utils.OK(c, offProductToResult(parsed.Product))
}

// ─── Saved Foods ──────────────────────────────────────────────────────────────

func (h *Handler) ListSavedFoods(c *gin.Context) {
	uid := middleware.UserID(c)

	foods, err := h.s.Food.ListSaved(uid)
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, foods)
}

func (h *Handler) CreateSavedFood(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.SaveFoodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if len(req.Name) > 200 {
		utils.BadRequest(c, "name exceeds 200 characters")
		return
	}
	if len(req.Brand) > 200 {
		utils.BadRequest(c, "brand exceeds 200 characters")
		return
	}
	if len(req.ServingSize) > 100 {
		utils.BadRequest(c, "serving_size exceeds 100 characters")
		return
	}
	if len(req.Barcode) > 50 {
		utils.BadRequest(c, "barcode exceeds 50 characters")
		return
	}

	f, err := h.s.Food.CreateSaved(uid, req)
	if utils.DBError(c, err) {
		return
	}
	utils.Created(c, f)
}

// savedFoodFromLog turns a logged entry back into a reusable single-serving
// food. A food log stores what was *eaten* (macros already multiplied by
// `servings`), while a saved food stores one serving — so every nutrient is
// divided back out, and `serving_size`/`serving_size_grams` describe that one
// unit exactly as the entry recorded it.
func savedFoodFromLog(l models.FoodLog) models.SaveFoodRequest {
	per := l.Servings
	if per <= 0 {
		per = 1
	}
	div := func(v float64) float64 {
		// Two decimals: the entry's totals were themselves rounded to one, so
		// anything finer is noise, but a 1/3-serving entry still round-trips.
		return math.Round((v/per)*100) / 100
	}
	name := strings.TrimSpace(l.Name)
	if name == "" {
		name = "Custom entry"
	}
	return models.SaveFoodRequest{
		Name:             name,
		Brand:            l.Brand,
		Calories:         div(l.Calories),
		Protein:          div(l.Protein),
		Carbs:            div(l.Carbs),
		Fat:              div(l.Fat),
		Fiber:            div(l.Fiber),
		Sugar:            div(l.Sugar),
		Sodium:           div(l.Sodium),
		Cholesterol:      div(l.Cholesterol),
		ServingSize:      l.ServingSize,
		ServingSizeGrams: l.ServingSizeGrams,
		Barcode:          l.Barcode,
		ImageURL:         l.ImageURL,
	}
}

// SaveFoodLogToMyFoods copies an already-logged entry — from any day — into the
// user's saved foods, so a meal entered by hand and forgotten at log time can
// still be kept without re-typing it.
//
// Saving the same food twice is the common case (a staple gets logged for weeks
// before anyone thinks to save it), so a name/brand/barcode match is reported as
// 409 with the existing row attached rather than silently duplicating it. The
// client then either leaves it alone or retries with ?overwrite=true, which
// refreshes the saved copy from this entry.
func (h *Handler) SaveFoodLogToMyFoods(c *gin.Context) {
	uid := middleware.UserID(c)
	fid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	entry, err := h.s.Food.Get(uid, fid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "food log not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}

	req := savedFoodFromLog(entry)
	existing, err := h.s.Food.FindSavedMatch(uid, req.Name, req.Brand, req.Barcode)
	switch {
	case err == nil && c.Query("overwrite") != "true":
		// Not utils.Conflict: the client needs the existing row to name it in the
		// "already saved — update it?" prompt.
		c.JSON(http.StatusConflict, gin.H{
			"error": fmt.Sprintf("%q is already in My Foods", existing.Name),
			"data":  existing,
		})
		return
	case err == nil:
		// SaveFoodRequest and UpdateSavedFoodRequest carry identical fields; the
		// conversion keeps them from drifting apart silently.
		f, err := h.s.Food.UpdateSaved(uid, existing.ID, models.UpdateSavedFoodRequest(req))
		if utils.DBError(c, err) {
			return
		}
		utils.OK(c, f)
	case err == sql.ErrNoRows:
		f, err := h.s.Food.CreateSaved(uid, req)
		if utils.DBError(c, err) {
			return
		}
		utils.Created(c, f)
	default:
		utils.DBError(c, err)
	}
}

func (h *Handler) GetSavedFood(c *gin.Context) {
	uid := middleware.UserID(c)
	fid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	f, err := h.s.Food.GetSaved(uid, fid)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "saved food not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, f)
}

func (h *Handler) UpdateSavedFood(c *gin.Context) {
	uid := middleware.UserID(c)
	fid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	var req models.UpdateSavedFoodRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if len(req.Name) > 200 {
		utils.BadRequest(c, "name exceeds 200 characters")
		return
	}
	if len(req.Brand) > 200 {
		utils.BadRequest(c, "brand exceeds 200 characters")
		return
	}
	if len(req.ServingSize) > 100 {
		utils.BadRequest(c, "serving_size exceeds 100 characters")
		return
	}
	if len(req.Barcode) > 50 {
		utils.BadRequest(c, "barcode exceeds 50 characters")
		return
	}

	f, err := h.s.Food.UpdateSaved(uid, fid, req)
	if err == sql.ErrNoRows {
		utils.NotFound(c, "saved food not found")
		return
	}
	if utils.DBError(c, err) {
		return
	}
	utils.OK(c, f)
}

func (h *Handler) DeleteSavedFood(c *gin.Context) {
	uid := middleware.UserID(c)
	fid, err := strconv.ParseInt(c.Param("id"), 10, 64)
	if err != nil {
		utils.BadRequest(c, "invalid id")
		return
	}

	n, err := h.s.Food.DeleteSaved(uid, fid)
	if utils.DBError(c, err) {
		return
	}
	if n == 0 {
		utils.NotFound(c, "saved food not found")
		return
	}
	utils.OK(c, gin.H{"deleted": true})
}

// ─── Nutrition label vision proxy ───

// AnalyzeFoodLabel photographs a nutrition facts label and returns a
// best-effort structured extraction via the configured vision provider
// (Anthropic/OpenAI/Gemini — see backend/vision). The result is always a
// suggestion: nothing is written to food_logs here, and the frontend routes
// the response through the same editable fields as manual entry.
func (h *Handler) AnalyzeFoodLabel(c *gin.Context) {
	var req models.AnalyzeLabelRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if len(req.ImageBase64) > maxLabelImageBytes {
		utils.BadRequest(c, "image too large — please retake at a lower resolution")
		return
	}
	if h.vision == nil {
		utils.ServiceUnavailable(c, "photo import is not configured on this server")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	result, err := h.vision.AnalyzeLabel(ctx, req.ImageBase64, req.MediaType)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			utils.ServiceUnavailable(c, "label analysis timed out — try again or enter manually")
			return
		}
		log.Printf("[food/analyze-label] vision error: %v", err)
		utils.ServiceUnavailable(c, "could not read the label — try again or enter manually")
		return
	}
	utils.OK(c, result)
}

// ParseMeal takes a free-text meal description and returns a best-effort
// split into discrete food items with estimated nutrition, via the same
// configured vision/AI provider as AnalyzeFoodLabel. The result is always a
// suggestion: nothing is written to food_logs here.
func (h *Handler) ParseMeal(c *gin.Context) {
	var req models.ParseMealRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if h.vision == nil {
		utils.ServiceUnavailable(c, "smart food entry is not configured on this server")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	items, err := h.vision.ParseMeal(ctx, req.Description)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			utils.ServiceUnavailable(c, "meal parsing timed out — try again or enter manually")
			return
		}
		log.Printf("[food/parse-meal] vision error: %v", err)
		utils.ServiceUnavailable(c, "could not parse that meal — try again or enter manually")
		return
	}
	utils.OK(c, gin.H{"items": items})
}

// AnalyzeMealPhoto takes a photo of a meal (plus an optional free-text
// description) and returns a best-effort breakdown of discrete food items
// with portion/nutrition estimates, confidence, and an overall assessment,
// via the same configured vision/AI provider as ParseMeal and
// AnalyzeFoodLabel. Unlike those two, on success the photo is persisted to
// disk (see backend/storage) and the response's image_url can be attached to
// the FoodLog the user ultimately creates from these items.
func (h *Handler) AnalyzeMealPhoto(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.AnalyzeMealPhotoRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if len(req.ImageBase64) > maxLabelImageBytes {
		utils.BadRequest(c, "image too large — please retake at a lower resolution")
		return
	}
	if h.vision == nil {
		utils.ServiceUnavailable(c, "photo meal analysis is not configured on this server")
		return
	}

	ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
	defer cancel()

	result, err := h.vision.AnalyzeMealPhoto(ctx, req.ImageBase64, req.MediaType, req.Description)
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			utils.ServiceUnavailable(c, "meal photo analysis timed out — try again or enter manually")
			return
		}
		log.Printf("[food/analyze-meal-photo] vision error: %v", err)
		utils.ServiceUnavailable(c, "could not analyze that photo — try again or enter manually")
		return
	}

	// Persist only after a successful vision call, so a rejected/unreadable
	// photo never leaves an orphaned file on disk.
	imgBytes, err := base64.StdEncoding.DecodeString(req.ImageBase64)
	if err != nil {
		utils.BadRequest(c, "invalid image data")
		return
	}
	relPath, err := storage.SavePhoto(config.C.MealPhotoDir, uid, imgBytes)
	if err != nil {
		log.Printf("[food/analyze-meal-photo] photo save error: %v", err)
		utils.ServiceUnavailable(c, "could not save that photo — try again")
		return
	}

	utils.OK(c, gin.H{
		"items":      result.Items,
		"assessment": result.Assessment,
		"image_url":  mealPhotoURLPrefix + relPath,
	})
}

// ServeMealPhoto serves back a meal photo persisted by AnalyzeMealPhoto.
// Only the owning user may fetch it; a mismatch returns 404 (not 403) so as
// not to confirm the photo exists for another user's id.
func (h *Handler) ServeMealPhoto(c *gin.Context) {
	uid := middleware.UserID(c)
	pathUID, err := strconv.ParseInt(c.Param("userID"), 10, 64)
	if err != nil || pathUID != uid {
		utils.NotFound(c, "photo not found")
		return
	}

	absPath, err := storage.AbsPath(config.C.MealPhotoDir, pathUID, c.Param("filename"))
	if err != nil {
		utils.NotFound(c, "photo not found")
		return
	}
	if _, err := os.Stat(absPath); err != nil {
		utils.NotFound(c, "photo not found")
		return
	}
	c.File(absPath)
}

// recommendRecentFoodLimit caps how many recently-logged food names are fed
// into the recommendation prompt as an implicit taste signal.
const recommendRecentFoodLimit = 25

// RecommendMeals suggests 2-3 meals for the requested meal slot, sized to the
// user's remaining daily macro budget (targets minus what's already logged on
// the requested date) and honoring the food preferences in user_settings.
// Like the other vision endpoints the result is always a suggestion: nothing
// is written to food_logs here.
func (h *Handler) RecommendMeals(c *gin.Context) {
	uid := middleware.UserID(c)
	var req models.RecommendMealsRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		utils.BadRequest(c, err.Error())
		return
	}
	if err := validate.Struct(req); err != nil {
		utils.ValidationError(c, err)
		return
	}
	if h.vision == nil {
		utils.ServiceUnavailable(c, "meal recommendations are not configured on this server")
		return
	}

	settings, err := h.s.User.GetSettings(uid)
	if err == sql.ErrNoRows {
		settings = models.DefaultUserSettings(uid)
	} else if utils.DBError(c, err) {
		return
	}
	stats, err := h.s.Food.DailyMacros(uid, req.Date)
	if utils.DBError(c, err) {
		return
	}
	recent, err := h.s.Food.RecentFoodNames(uid, recommendRecentFoodLimit)
	if utils.DBError(c, err) {
		return
	}

	// Remaining budget clamps at 0 — the prompt tells the model to go light
	// when the day's target is already spent, not to suggest negative food.
	remaining := func(target int, consumed float64) float64 {
		if r := float64(target) - consumed; r > 0 {
			return r
		}
		return 0
	}

	// Recommendations generate more output tokens than a single parsed meal,
	// so this timeout is longer than the 20s used by the other AI endpoints.
	// 60s: Gemini in particular has been observed taking ~30s server-side on
	// this request, and the SDK propagates the ctx deadline upstream — a 30s
	// budget produced upstream 504s right at the wire.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
	defer cancel()

	recs, err := h.vision.RecommendMeals(ctx, vision.RecommendRequest{
		Meal:              req.Meal,
		RemainingCalories: remaining(settings.CalorieTarget, stats.TotalCalories),
		RemainingProtein:  remaining(settings.ProteinTarget, stats.TotalProtein),
		RemainingCarbs:    remaining(settings.CarbTarget, stats.TotalCarbs),
		RemainingFat:      remaining(settings.FatTarget, stats.TotalFat),
		Allergies:         settings.FoodAllergies,
		Dislikes:          settings.FoodDislikes,
		Likes:             settings.FoodLikes,
		RecentFoods:       recent,
	})
	if err != nil {
		if ctx.Err() == context.DeadlineExceeded {
			utils.ServiceUnavailable(c, "meal recommendations timed out — try again")
			return
		}
		log.Printf("[food/recommend] vision error: %v", err)
		utils.ServiceUnavailable(c, "could not generate recommendations — try again")
		return
	}
	utils.OK(c, gin.H{"recommendations": recs})
}
