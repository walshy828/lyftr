package controllers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/Cawlumm/lyftr-backend/models"
)

// USDA FoodData Central proxy — the second food-search source alongside Open
// Food Facts. OFF indexes barcoded packaged goods; FDC covers generic whole
// foods ("grilled chicken breast") and, unlike OFF, publishes gram weights for
// household measures, which is what makes an exact "1 tbsp" portion possible.
//
// Enabled only when FDC_API_KEY is set; otherwise search stays OFF-only.

var fdcClient = &http.Client{Timeout: 5 * time.Second}

// fdcSearchURL and fdcDetailURL are vars, not consts, so tests can retarget
// them at an httptest server the same way offMockTransport retargets the OFF
// calls.
var (
	fdcSearchURL = "https://api.nal.usda.gov/fdc/v1/foods/search"
	fdcDetailURL = "https://api.nal.usda.gov/fdc/v1/foods"
)

// FDC nutrient numbers. FDC reports sodium and cholesterol in mg already —
// unlike OFF, which uses grams and needs offGramsToMg.
const (
	fdcNutrientCalories    = 1008
	fdcNutrientProtein     = 1003
	fdcNutrientCarbs       = 1005
	fdcNutrientFat         = 1004
	fdcNutrientFiber       = 1079
	fdcNutrientSugar       = 2000
	fdcNutrientSodium      = 1093
	fdcNutrientCholesterol = 1253
)

type fdcSearchResponse struct {
	Foods []fdcFood `json:"foods"`
}

type fdcFood struct {
	FDCID                    int              `json:"fdcId"`
	Description              string           `json:"description"`
	BrandOwner               string           `json:"brandOwner"`
	BrandName                string           `json:"brandName"`
	DataType                 string           `json:"dataType"`
	GTINUpc                  string           `json:"gtinUpc"`
	PublicationDate          string           `json:"publicationDate"`
	ServingSize              float64          `json:"servingSize"`
	ServingSizeUnit          string           `json:"servingSizeUnit"`
	HouseholdServingFullText string           `json:"householdServingFullText"`
	FoodNutrients            []fdcNutrient    `json:"foodNutrients"`
	FoodMeasures             []fdcFoodMeasure `json:"foodMeasures"`

	// LabelNutrients is the printed Nutrition Facts panel, per labeled serving.
	// Branded foods only, and — importantly — only returned by the detail
	// endpoints, never by search. See hydrateFDCLabels.
	LabelNutrients *fdcLabelNutrients `json:"labelNutrients"`
}

// fdcLabelValue is FDC's uniform wrapper for a label figure: every entry in
// labelNutrients is an object with a single "value" key.
type fdcLabelValue struct {
	Value float64 `json:"value"`
}

// fdcLabelNutrients is the Nutrition Facts panel as FDC publishes it. The JSON
// key names are FDC's own and differ from ours ("carbohydrates", "sugars"), so
// they are mapped explicitly rather than inferred.
//
// Unlike the per-100g foodNutrients array, these values are already per
// labeled serving, and sodium/cholesterol are already in milligrams — no
// offGramsToMg equivalent is needed.
type fdcLabelNutrients struct {
	Calories      fdcLabelValue `json:"calories"`
	Protein       fdcLabelValue `json:"protein"`
	Carbohydrates fdcLabelValue `json:"carbohydrates"`
	Fat           fdcLabelValue `json:"fat"`
	Fiber         fdcLabelValue `json:"fiber"`
	Sugars        fdcLabelValue `json:"sugars"`
	Sodium        fdcLabelValue `json:"sodium"`
	Cholesterol   fdcLabelValue `json:"cholesterol"`
}

type fdcNutrient struct {
	NutrientID int     `json:"nutrientId"`
	Value      float64 `json:"value"`
}

// fdcFoodMeasure is one household portion FDC publishes for a food, e.g.
// {disseminationText: "1 tbsp", gramWeight: 13.8}.
type fdcFoodMeasure struct {
	DisseminationText string  `json:"disseminationText"`
	Modifier          string  `json:"modifier"`
	MeasureUnitName   string  `json:"measureUnitName"`
	Amount            float64 `json:"amount"`
	GramWeight        float64 `json:"gramWeight"`
}

func fdcNutrientValue(nutrients []fdcNutrient, id int) float64 {
	for _, n := range nutrients {
		if n.NutrientID == id {
			return n.Value
		}
	}
	return 0
}

// fdcMeasureLabel builds a human portion label from whichever fields FDC
// populated — disseminationText is already formatted when present, otherwise
// we compose amount + modifier/unit.
func fdcMeasureLabel(m fdcFoodMeasure) string {
	if t := strings.TrimSpace(m.DisseminationText); t != "" {
		return t
	}
	unit := strings.TrimSpace(m.Modifier)
	if unit == "" {
		unit = strings.TrimSpace(m.MeasureUnitName)
	}
	if unit == "" || unit == "undetermined" {
		return ""
	}
	if m.Amount > 0 {
		return strings.TrimSpace(fmt.Sprintf("%g %s", m.Amount, unit))
	}
	return unit
}

// fdcFoodToResult normalizes an FDC food to the shared search-result shape.
//
// Two paths, and which one runs is the whole point of this file:
//
//   - A Branded food with a hydrated label panel is quoted straight off its
//     Nutrition Facts label — per declared serving, exactly the numbers printed
//     on the package. This is the accurate representation of a US product.
//   - Everything else (Foundation, SR Legacy, or a Branded food whose detail
//     lookup didn't land) falls back to the per-100g foodNutrients array, with
//     the per-serving information offered through the portions list instead.
func fdcFoodToResult(f fdcFood) models.FoodSearchResult {
	brand := strings.TrimSpace(f.BrandName)
	if brand == "" {
		brand = strings.TrimSpace(f.BrandOwner)
	}

	servingGrams := fdcServingGrams(f.ServingSize, f.ServingSizeUnit)

	var portions []models.FoodPortion
	seen := map[string]bool{}
	addPortion := func(label string, grams float64) {
		label = strings.TrimSpace(label)
		if label == "" || grams <= 0 || seen[strings.ToLower(label)] {
			return
		}
		seen[strings.ToLower(label)] = true
		portions = append(portions, models.FoodPortion{Label: label, Grams: grams})
	}

	// Branded foods carry a single declared serving rather than a measure list.
	servingLabel := tidyHouseholdServing(f.HouseholdServingFullText)
	if servingGrams > 0 {
		label := servingLabel
		if label == "" {
			label = fmt.Sprintf("%g g", servingGrams)
		}
		addPortion(label, servingGrams)
	}
	for _, m := range f.FoodMeasures {
		addPortion(fdcMeasureLabel(m), m.GramWeight)
	}

	r := models.FoodSearchResult{
		Name:      strings.TrimSpace(f.Description),
		Brand:     brand,
		Portions:  portions,
		Barcode:   strings.TrimSpace(f.GTINUpc),
		LabelDate: strings.TrimSpace(f.PublicationDate),
		Source:    "fdc",
	}

	if ln := f.LabelNutrients; ln != nil && ln.Calories.Value > 0 {
		r.Calories = ln.Calories.Value
		r.Protein = ln.Protein.Value
		r.Carbs = ln.Carbohydrates.Value
		r.Fat = ln.Fat.Value
		r.Fiber = ln.Fiber.Value
		r.Sugar = ln.Sugars.Value
		r.Sodium = ln.Sodium.Value           // already mg
		r.Cholesterol = ln.Cholesterol.Value // already mg
		r.LabelAccurate = true

		// The label figures describe one declared serving, so the serving
		// label and gram basis must describe that same serving — otherwise the
		// client rescales correct numbers by a wrong divisor.
		switch {
		case servingLabel != "":
			r.ServingSize = servingLabel
		case servingGrams > 0:
			r.ServingSize = fmt.Sprintf("%g g", servingGrams)
		default:
			r.ServingSize = "1 serving"
		}
		r.ServingSizeGrams = servingGrams
		return r
	}

	r.Calories = fdcNutrientValue(f.FoodNutrients, fdcNutrientCalories)
	r.Protein = fdcNutrientValue(f.FoodNutrients, fdcNutrientProtein)
	r.Carbs = fdcNutrientValue(f.FoodNutrients, fdcNutrientCarbs)
	r.Fat = fdcNutrientValue(f.FoodNutrients, fdcNutrientFat)
	r.Fiber = fdcNutrientValue(f.FoodNutrients, fdcNutrientFiber)
	r.Sugar = fdcNutrientValue(f.FoodNutrients, fdcNutrientSugar)
	r.Sodium = fdcNutrientValue(f.FoodNutrients, fdcNutrientSodium)
	r.Cholesterol = fdcNutrientValue(f.FoodNutrients, fdcNutrientCholesterol)
	r.ServingSize = "per 100g"
	r.ServingSizeGrams = 100
	return r
}

// searchFDC queries FoodData Central and returns normalized results. Callers
// treat any error as "this source contributed nothing" — search still succeeds
// on whatever the other source returned.
func searchFDC(ctx context.Context, apiKey, query string, limit int) ([]models.FoodSearchResult, error) {
	results, _, err := searchFDCFoods(ctx, apiKey, query, limit)
	return results, err
}

// searchFDCFoods is searchFDC plus the raw upstream records, positionally
// aligned with the results. The barcode path needs the raw gtinUpc to verify a
// match, which the normalized shape alone can't prove.
func searchFDCFoods(ctx context.Context, apiKey, query string, limit int) ([]models.FoodSearchResult, []fdcFood, error) {
	body, err := json.Marshal(map[string]any{
		"query":      query,
		"dataType":   []string{"Foundation", "SR Legacy", "Branded"},
		"pageSize":   limit,
		"pageNumber": 1,
	})
	if err != nil {
		return nil, nil, err
	}

	reqURL := fdcSearchURL + "?api_key=" + url.QueryEscape(apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return nil, nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", offUserAgent)

	resp, err := fdcClient.Do(req)
	if err != nil {
		return nil, nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4 MB limit
	if err != nil {
		return nil, nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, nil, fmt.Errorf("fdc: unexpected status %d", resp.StatusCode)
	}

	var parsed fdcSearchResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, nil, err
	}

	foods := hydrateFDCLabels(ctx, apiKey, parsed.Foods)

	// results and kept stay index-aligned so a caller holding one can reach the
	// raw record behind it.
	results := make([]models.FoodSearchResult, 0, len(foods))
	kept := make([]fdcFood, 0, len(foods))
	for _, f := range foods {
		if strings.TrimSpace(f.Description) == "" {
			continue
		}
		results = append(results, fdcFoodToResult(f))
		kept = append(kept, f)
	}
	return results, kept, nil
}

// maxFDCHydrateIDs caps how many foods one detail call asks for. Search is
// already limited to 50, so this is a backstop against an oversized request
// rather than a real constraint.
const maxFDCHydrateIDs = 50

// hydrateFDCLabels fills in the Nutrition Facts panel for Branded foods.
//
// FDC's search endpoint does not return labelNutrients — only the detail
// endpoints do — so getting the printed label costs a second call. It is one
// batched POST for the whole result page rather than one per food, which keeps
// the added latency at roughly a third of a second against search's own second.
//
// Best-effort by design: any failure returns the input untouched, and the
// caller falls back to per-100g values. A slow or broken detail lookup must
// degrade the numbers, never fail the search.
func hydrateFDCLabels(ctx context.Context, apiKey string, foods []fdcFood) []fdcFood {
	ids := make([]int, 0, len(foods))
	for _, f := range foods {
		if f.FDCID > 0 && strings.EqualFold(strings.TrimSpace(f.DataType), "branded") {
			ids = append(ids, f.FDCID)
		}
	}
	if len(ids) == 0 {
		return foods
	}
	if len(ids) > maxFDCHydrateIDs {
		ids = ids[:maxFDCHydrateIDs]
	}

	start := time.Now()
	detailed, err := fetchFDCFoods(ctx, apiKey, ids)
	log.Printf("[food/fdc] label hydrate: requested=%d returned=%d duration=%dms err=%v",
		len(ids), len(detailed), time.Since(start).Milliseconds(), err)
	if err != nil {
		return foods
	}

	byID := make(map[int]fdcFood, len(detailed))
	for _, d := range detailed {
		byID[d.FDCID] = d
	}

	// Merge only the fields search couldn't supply. The search result stays
	// authoritative for name, brand and ranking order.
	for i, f := range foods {
		d, ok := byID[f.FDCID]
		if !ok {
			continue
		}
		foods[i].LabelNutrients = d.LabelNutrients
		if foods[i].GTINUpc == "" {
			foods[i].GTINUpc = d.GTINUpc
		}
		if foods[i].PublicationDate == "" {
			foods[i].PublicationDate = d.PublicationDate
		}
		if foods[i].ServingSize == 0 {
			foods[i].ServingSize = d.ServingSize
			foods[i].ServingSizeUnit = d.ServingSizeUnit
		}
		if foods[i].HouseholdServingFullText == "" {
			foods[i].HouseholdServingFullText = d.HouseholdServingFullText
		}
	}
	return foods
}

// fetchFDCFoods retrieves full records for a set of FDC IDs in one call.
func fetchFDCFoods(ctx context.Context, apiKey string, ids []int) ([]fdcFood, error) {
	body, err := json.Marshal(map[string]any{
		"fdcIds": ids,
		"format": "full", // "abridged" omits labelNutrients
	})
	if err != nil {
		return nil, err
	}

	reqURL := fdcDetailURL + "?api_key=" + url.QueryEscape(apiKey)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, reqURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", offUserAgent)

	resp, err := fdcClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20)) // full records are larger than search hits
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fdc: detail unexpected status %d", resp.StatusCode)
	}

	var parsed []fdcFood
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}
	return parsed, nil
}

// lookupFDCByGTIN resolves a scanned barcode to a single food.
//
// FDC has no barcode endpoint; the GTIN is matched by searching for it as a
// keyword, which only hits when the code is padded to FDC's 14-digit storage
// form. Because that is still a fuzzy text search, the returned gtinUpc is
// verified against the one asked for — an unverified match would attach a
// completely unrelated product to the user's scan.
func lookupFDCByGTIN(ctx context.Context, apiKey, gtin string) (models.FoodSearchResult, bool, error) {
	results, foods, err := searchFDCFoods(ctx, apiKey, gtin, 5)
	if err != nil {
		return models.FoodSearchResult{}, false, err
	}
	for i, f := range foods {
		if normalizeGTIN(strings.TrimSpace(f.GTINUpc)) == gtin {
			return results[i], true, nil
		}
	}
	return models.FoodSearchResult{}, false, nil
}
