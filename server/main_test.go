package main

import (
	"os"
	"testing"
)

func TestMainHelpDoesNotStartServer(t *testing.T) {
	oldArgs := os.Args
	os.Args = []string{"kmtv", "--help"}
	t.Cleanup(func() { os.Args = oldArgs })

	main()
}
