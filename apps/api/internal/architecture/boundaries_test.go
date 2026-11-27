package architecture_test

import (
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// Check real imports, including tests. Modules may use platform and their own
// package; composition belongs to app and HTTP adapters belong to transport.
func TestModuleBoundaries(t *testing.T) {
	const prefix = "github.com/DravenDou/openstockai/apps/api/internal/"
	count := 0
	err := filepath.WalkDir("..", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if entry.IsDir() || !strings.HasSuffix(path, ".go") {
			return nil
		}
		count++
		file, err := parser.ParseFile(token.NewFileSet(), path, nil, parser.ImportsOnly)
		if err != nil {
			return err
		}
		local, err := filepath.Rel("..", path)
		if err != nil {
			return err
		}
		from := strings.Split(filepath.ToSlash(local), "/")
		for _, imp := range file.Imports {
			name, err := strconv.Unquote(imp.Path.Value)
			if err != nil {
				return err
			}
			if !strings.HasPrefix(name, prefix) {
				continue
			}
			to := strings.Split(strings.TrimPrefix(name, prefix), "/")
			allowed := true
			switch from[0] {
			case "platform":
				allowed = to[0] == "platform"
			case "modules":
				allowed = to[0] == "platform" || (len(to) > 1 && to[0] == "modules" && to[1] == from[1])
			case "app":
				allowed = to[0] == "platform" || to[0] == "modules"
			}
			if !allowed {
				t.Errorf("dependency outside the module boundary: %s -> %s", local, name)
			}
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if count < 15 {
		t.Fatalf("the check did not walk the real packages: %d files", count)
	}
}
