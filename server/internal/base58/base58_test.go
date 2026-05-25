package base58

import "testing"

func TestEncodeDecodeRoundTrip(t *testing.T) {
	input := []byte{0, 0, 1, 2, 3, 255, 254, 253}
	encoded := Encode(input)
	decoded := Decode(encoded)
	if string(decoded) != string(input) {
		t.Fatalf("Decode(Encode(input)) = %v, want %v", decoded, input)
	}
}

func TestDecodeRejectsInvalidInput(t *testing.T) {
	if got := Decode("0OIl"); len(got) != 0 {
		t.Fatalf("Decode invalid input = %v, want empty", got)
	}
}
