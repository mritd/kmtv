package store

import (
	"errors"
	"testing"

	"github.com/mritd/kmtv/internal/errs"
	"github.com/mritd/kmtv/internal/model"
)

func TestCreateSource(t *testing.T) {
	s := newTestStore(t)

	src := &model.Source{
		Key:     "example.com",
		Name:    "Example",
		API:     "https://example.com/api",
		Detail:  "https://example.com",
		Enabled: true,
		Comment: "test source",
	}
	id, err := s.CreateSource(src)
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}
	if id <= 0 {
		t.Errorf("expected positive ID, got %d", id)
	}

	got, err := s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID error: %v", err)
	}
	if got == nil {
		t.Fatal("expected source, got nil")
		return
	}
	if got.Key != "example.com" {
		t.Errorf("expected key=example.com, got %q", got.Key)
	}
	if got.Name != "Example" {
		t.Errorf("expected name=Example, got %q", got.Name)
	}
	if got.Health != "unknown" {
		t.Errorf("expected default health=unknown, got %q", got.Health)
	}
}

func TestGetSource(t *testing.T) {
	s := newTestStore(t)

	src := &model.Source{
		Key:     "test.com",
		Name:    "Test",
		API:     "https://test.com/api",
		Enabled: true,
	}
	_, err := s.CreateSource(src)
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	// Get by key.
	got, err := s.GetSourceByKey("test.com")
	if err != nil {
		t.Fatalf("GetSourceByKey error: %v", err)
	}
	if got == nil {
		t.Fatal("expected source, got nil")
		return
	}
	if got.Name != "Test" {
		t.Errorf("expected name=Test, got %q", got.Name)
	}

	// Non-existent key returns nil.
	got, err = s.GetSourceByKey("nonexistent.com")
	if err != nil {
		t.Fatalf("GetSourceByKey error for nonexistent: %v", err)
	}
	if got != nil {
		t.Errorf("expected nil for nonexistent key, got %+v", got)
	}
}

func TestListEnabledHealthySources(t *testing.T) {
	s := newTestStore(t)

	sources := []struct {
		src    *model.Source
		health string
	}{
		{&model.Source{Key: "a.com", Name: "A", API: "https://a.com/api", Enabled: true}, "healthy"},
		{&model.Source{Key: "b.com", Name: "B", API: "https://b.com/api", Enabled: true}, "unhealthy"},
		{&model.Source{Key: "c.com", Name: "C", API: "https://c.com/api", Enabled: false}, "healthy"},
		{&model.Source{Key: "d.com", Name: "D", API: "https://d.com/api", Enabled: true}, "unknown"},
	}

	for _, s2 := range sources {
		id, err := s.CreateSource(s2.src)
		if err != nil {
			t.Fatalf("CreateSource error: %v", err)
		}
		if err := s.UpdateSourceHealth(id, s2.health); err != nil {
			t.Fatalf("UpdateSourceHealth error: %v", err)
		}
	}

	// ListEnabledHealthySources: enabled=true AND health!='unhealthy' => A (healthy), D (unknown)
	got, err := s.ListEnabledHealthySources()
	if err != nil {
		t.Fatalf("ListEnabledHealthySources error: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("expected 2 sources, got %d", len(got))
	}
	if got[0].Key != "a.com" {
		t.Errorf("expected first source key=a.com, got %q", got[0].Key)
	}
	if got[1].Key != "d.com" {
		t.Errorf("expected second source key=d.com, got %q", got[1].Key)
	}
}

func TestListEnabledSources(t *testing.T) {
	s := newTestStore(t)

	if _, err := s.CreateSource(&model.Source{Key: "enabled.example", Name: "Enabled", API: "https://enabled.example/api", Enabled: true}); err != nil {
		t.Fatalf("CreateSource enabled error: %v", err)
	}
	if _, err := s.CreateSource(&model.Source{Key: "disabled.example", Name: "Disabled", API: "https://disabled.example/api", Enabled: false}); err != nil {
		t.Fatalf("CreateSource disabled error: %v", err)
	}

	sources, err := s.ListEnabledSources()
	if err != nil {
		t.Fatalf("ListEnabledSources error: %v", err)
	}
	if len(sources) != 1 || sources[0].Key != "enabled.example" {
		t.Fatalf("unexpected enabled sources: %+v", sources)
	}
}

func TestUpdateSourceHealth(t *testing.T) {
	s := newTestStore(t)

	src := &model.Source{
		Key:     "health.com",
		Name:    "Health",
		API:     "https://health.com/api",
		Enabled: true,
	}
	id, err := s.CreateSource(src)
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	// Initially health is "unknown" and last_check is zero.
	got, err := s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID error: %v", err)
	}
	if got.Health != "unknown" {
		t.Errorf("expected initial health=unknown, got %q", got.Health)
	}
	if !got.LastCheck.IsZero() {
		t.Errorf("expected zero last_check, got %v", got.LastCheck)
	}

	// Update health.
	if err := s.UpdateSourceHealth(id, "healthy"); err != nil {
		t.Fatalf("UpdateSourceHealth error: %v", err)
	}

	got, err = s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID error: %v", err)
	}
	if got.Health != "healthy" {
		t.Errorf("expected health=healthy, got %q", got.Health)
	}
	if got.LastCheck.IsZero() {
		t.Error("expected last_check to be set after health update")
	}
}

func TestListAndUpdateSource(t *testing.T) {
	s := newTestStore(t)

	id, err := s.CreateSource(&model.Source{
		Key:        "update.example",
		Name:       "Before",
		API:        "https://before.example/api.php",
		Detail:     "https://before.example/detail",
		Enabled:    true,
		Comment:    "before",
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	sources, err := s.ListSources()
	if err != nil {
		t.Fatalf("ListSources error: %v", err)
	}
	if len(sources) != 1 || sources[0].Key != "update.example" {
		t.Fatalf("unexpected sources: %+v", sources)
	}

	if err := s.UpdateSource(
		id,
		"After",
		"https://after.example/api.php",
		"https://after.example/detail",
		"after",
		false,
	); err != nil {
		t.Fatalf("UpdateSource error: %v", err)
	}
	got, err := s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID error: %v", err)
	}
	if got.Name != "After" || got.API != "https://after.example/api.php" || got.Enabled {
		t.Fatalf("source not updated correctly: %+v", got)
	}
}

func TestSourceSearchableAndDelete(t *testing.T) {
	s := newTestStore(t)

	id, err := s.CreateSource(&model.Source{
		Key:        "searchable.example",
		Name:       "Searchable",
		API:        "https://searchable.example/api.php",
		Enabled:    true,
		Searchable: true,
	})
	if err != nil {
		t.Fatalf("CreateSource error: %v", err)
	}

	if err := s.UpdateSourceSearchable(id, false); err != nil {
		t.Fatalf("UpdateSourceSearchable error: %v", err)
	}
	got, err := s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID error: %v", err)
	}
	if got.Searchable {
		t.Fatal("expected source searchable=false")
	}

	if err := s.DeleteSource(id); err != nil {
		t.Fatalf("DeleteSource error: %v", err)
	}
	got, err = s.GetSourceByID(id)
	if err != nil {
		t.Fatalf("GetSourceByID after delete error: %v", err)
	}
	if got != nil {
		t.Fatalf("expected deleted source to be nil, got %+v", got)
	}
	if err := s.DeleteSource(id); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("DeleteSource deleted id = %v, want ErrNotFound", err)
	}
	if err := s.UpdateSource(id, "missing", "https://missing.example/api", "", "", true); !errors.Is(err, errs.ErrNotFound) {
		t.Fatalf("UpdateSource deleted id = %v, want ErrNotFound", err)
	}
}

func TestUpsertSourceByKey(t *testing.T) {
	s := newTestStore(t)

	src := &model.Source{
		Key:        "upsert.example",
		Name:       "Original",
		API:        "https://original.example/api.php",
		Enabled:    true,
		Searchable: true,
	}
	if err := s.UpsertSourceByKey(src); err != nil {
		t.Fatalf("first UpsertSourceByKey error: %v", err)
	}
	src.Name = "Updated"
	src.API = "https://updated.example/api.php"
	if err := s.UpsertSourceByKey(src); err != nil {
		t.Fatalf("second UpsertSourceByKey error: %v", err)
	}

	got, err := s.GetSourceByKey("upsert.example")
	if err != nil {
		t.Fatalf("GetSourceByKey error: %v", err)
	}
	if got.Name != "Updated" || got.API != "https://updated.example/api.php" {
		t.Fatalf("upsert did not update source: %+v", got)
	}
}
