package store

import (
	"testing"
)

func TestSyncEpochIsGeneratedPerDatabase(t *testing.T) {
	first := newTestStore(t)
	second := newTestStore(t)

	a, err := first.SyncEpoch()
	if err != nil || a == "" {
		t.Fatalf("first epoch = %q, err = %v", a, err)
	}
	again, err := first.SyncEpoch()
	if err != nil || again != a {
		t.Fatalf("epoch must be stable within one database: %q vs %q (err %v)", a, again, err)
	}
	b, err := second.SyncEpoch()
	if err != nil || b == "" || b == a {
		t.Fatalf("second database must get its own epoch: %q vs %q (err %v)", a, b, err)
	}
}
