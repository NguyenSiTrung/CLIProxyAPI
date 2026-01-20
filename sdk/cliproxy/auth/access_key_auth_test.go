package auth

import (
	"context"
	"errors"
	"net/http"
	"testing"

	internalconfig "github.com/router-for-me/CLIProxyAPI/v6/internal/config"
	"github.com/router-for-me/CLIProxyAPI/v6/internal/registry"
	cliproxyexecutor "github.com/router-for-me/CLIProxyAPI/v6/sdk/cliproxy/executor"
)

type recordingExecutor struct {
	provider   string
	selectedID string
}

func (r *recordingExecutor) Identifier() string {
	return r.provider
}

func (r *recordingExecutor) Execute(_ context.Context, auth *Auth, _ cliproxyexecutor.Request, _ cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	if auth != nil {
		r.selectedID = auth.ID
	}
	return cliproxyexecutor.Response{Payload: []byte(`{}`)}, nil
}

func (r *recordingExecutor) ExecuteStream(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (<-chan cliproxyexecutor.StreamChunk, error) {
	return nil, errors.New("not implemented")
}

func (r *recordingExecutor) Refresh(_ context.Context, auth *Auth) (*Auth, error) {
	return auth, nil
}

func (r *recordingExecutor) CountTokens(context.Context, *Auth, cliproxyexecutor.Request, cliproxyexecutor.Options) (cliproxyexecutor.Response, error) {
	return cliproxyexecutor.Response{}, errors.New("not implemented")
}

func (r *recordingExecutor) HttpRequest(context.Context, *Auth, *http.Request) (*http.Response, error) {
	return nil, errors.New("not implemented")
}

func TestAccessKeyAuthAllowlistFiltersAuths(t *testing.T) {
	mgr := NewManager(nil, &FillFirstSelector{}, nil)
	exec := &recordingExecutor{provider: "antigravity"}
	mgr.RegisterExecutor(exec)

	ctx := context.Background()
	_, _ = mgr.Register(ctx, &Auth{ID: "antigravity-a.json", Provider: "antigravity", Status: StatusActive})
	_, _ = mgr.Register(ctx, &Auth{ID: "antigravity-b.json", Provider: "antigravity", Status: StatusActive})

	registry.GetGlobalRegistry().RegisterClient("antigravity-a.json", "antigravity", []*registry.ModelInfo{{ID: "test-model"}})
	registry.GetGlobalRegistry().RegisterClient("antigravity-b.json", "antigravity", []*registry.ModelInfo{{ID: "test-model"}})
	defer func() {
		registry.GetGlobalRegistry().UnregisterClient("antigravity-a.json")
		registry.GetGlobalRegistry().UnregisterClient("antigravity-b.json")
	}()

	mgr.SetConfig(&internalconfig.Config{
		AccessKeyAuths: []internalconfig.AccessKeyAuth{
			{
				APIKey:   "client-key",
				Provider: "antigravity",
				AuthIDs:  []string{"antigravity-b.json"},
			},
		},
	})

	opts := cliproxyexecutor.Options{
		Metadata: map[string]any{AccessKeyMetadataKey: "client-key"},
	}
	req := cliproxyexecutor.Request{Model: "test-model", Payload: []byte(`{}`)}

	if _, err := mgr.Execute(ctx, []string{"antigravity"}, req, opts); err != nil {
		t.Fatalf("execute failed: %v", err)
	}
	if exec.selectedID != "antigravity-b.json" {
		t.Fatalf("expected auth %q, got %q", "antigravity-b.json", exec.selectedID)
	}
}
