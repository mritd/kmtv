package service

import (
	"testing"

	"github.com/mritd/kmtv/internal/model"
)

func TestFilterAdultSources(t *testing.T) {
	sources := []model.Source{
		{Key: "a.com", Name: "Normal A"},
		{Key: "b.com", Name: "Adult B", IsAdult: true},
		{Key: "c.com", Name: "Normal C"},
		{Key: "d.com", Name: "Adult D", IsAdult: true},
	}

	result := FilterAdultSources(sources)
	if len(result) != 2 {
		t.Fatalf("len(result) = %d, want 2", len(result))
	}
	if result[0].Key != "a.com" {
		t.Errorf("result[0].Key = %q, want %q", result[0].Key, "a.com")
	}
	if result[1].Key != "c.com" {
		t.Errorf("result[1].Key = %q, want %q", result[1].Key, "c.com")
	}
}

func TestFilterAdultResults(t *testing.T) {
	results := []model.SearchResult{
		{
			Title: "Movie A",
			Sources: []model.SourceResult{
				{SourceKey: "a.com", SourceName: "Normal A"},
				{SourceKey: "b.com", SourceName: "Adult B", IsAdult: true},
			},
		},
		{
			Title: "Movie B",
			Sources: []model.SourceResult{
				{SourceKey: "c.com", SourceName: "Adult C", IsAdult: true},
			},
		},
	}

	filtered := FilterAdultResults(results)
	if len(filtered) != 1 {
		t.Fatalf("len(filtered) = %d, want 1", len(filtered))
	}
	if filtered[0].Title != "Movie A" {
		t.Errorf("filtered[0].Title = %q, want %q", filtered[0].Title, "Movie A")
	}
	if len(filtered[0].Sources) != 1 {
		t.Fatalf("len(filtered[0].Sources) = %d, want 1", len(filtered[0].Sources))
	}
	if filtered[0].Sources[0].SourceKey != "a.com" {
		t.Errorf("filtered[0].Sources[0].SourceKey = %q, want %q", filtered[0].Sources[0].SourceKey, "a.com")
	}
}
