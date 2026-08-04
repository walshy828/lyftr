package controllers

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
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

// fdcSearchURL is a var, not a const, so tests can retarget it at an httptest
// server the same way offMockTransport retargets the OFF calls.
var fdcSearchURL = "https://api.nal.usda.gov/fdc/v1/foods/search"

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
	Description              string           `json:"description"`
	BrandOwner               string           `json:"brandOwner"`
	BrandName                string           `json:"brandName"`
	DataType                 string           `json:"dataType"`
	ServingSize              float64          `json:"servingSize"`
	ServingSizeUnit          string           `json:"servingSizeUnit"`
	HouseholdServingFullText string           `json:"householdServingFullText"`
	FoodNutrients            []fdcNutrient    `json:"foodNutrients"`
	FoodMeasures             []fdcFoodMeasure `json:"foodMeasures"`
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
// FDC nutrient values are per 100 g across all data types, so the gram basis is
// always 100 — the per-serving information lives in the portions list instead.
func fdcFoodToResult(f fdcFood) models.FoodSearchResult {
	brand := strings.TrimSpace(f.BrandName)
	if brand == "" {
		brand = strings.TrimSpace(f.BrandOwner)
	}

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
	if f.ServingSize > 0 && strings.EqualFold(strings.TrimSpace(f.ServingSizeUnit), "g") {
		label := strings.TrimSpace(f.HouseholdServingFullText)
		if label == "" {
			label = fmt.Sprintf("%g g", f.ServingSize)
		}
		addPortion(label, f.ServingSize)
	}
	for _, m := range f.FoodMeasures {
		addPortion(fdcMeasureLabel(m), m.GramWeight)
	}

	return models.FoodSearchResult{
		Name:             strings.TrimSpace(f.Description),
		Brand:            brand,
		Calories:         fdcNutrientValue(f.FoodNutrients, fdcNutrientCalories),
		Protein:          fdcNutrientValue(f.FoodNutrients, fdcNutrientProtein),
		Carbs:            fdcNutrientValue(f.FoodNutrients, fdcNutrientCarbs),
		Fat:              fdcNutrientValue(f.FoodNutrients, fdcNutrientFat),
		Fiber:            fdcNutrientValue(f.FoodNutrients, fdcNutrientFiber),
		Sugar:            fdcNutrientValue(f.FoodNutrients, fdcNutrientSugar),
		Sodium:           fdcNutrientValue(f.FoodNutrients, fdcNutrientSodium),
		Cholesterol:      fdcNutrientValue(f.FoodNutrients, fdcNutrientCholesterol),
		ServingSize:      "per 100g",
		ServingSizeGrams: 100,
		Portions:         portions,
		Source:           "fdc",
	}
}

// searchFDC queries FoodData Central and returns normalized results. Callers
// treat any error as "this source contributed nothing" — search still succeeds
// on whatever the other source returned.
func searchFDC(ctx context.Context, apiKey, query string, limit int) ([]models.FoodSearchResult, error) {
	body, err := json.Marshal(map[string]any{
		"query":      query,
		"dataType":   []string{"Foundation", "SR Legacy", "Branded"},
		"pageSize":   limit,
		"pageNumber": 1,
	})
	if err != nil {
		return nil, err
	}

	reqURL := fdcSearchURL + "?api_key=" + url.QueryEscape(apiKey)
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

	raw, err := io.ReadAll(io.LimitReader(resp.Body, 4<<20)) // 4 MB limit
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fdc: unexpected status %d", resp.StatusCode)
	}

	var parsed fdcSearchResponse
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return nil, err
	}

	results := make([]models.FoodSearchResult, 0, len(parsed.Foods))
	for _, f := range parsed.Foods {
		if strings.TrimSpace(f.Description) == "" {
			continue
		}
		results = append(results, fdcFoodToResult(f))
	}
	return results, nil
}
