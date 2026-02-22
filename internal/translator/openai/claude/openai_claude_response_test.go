package claude

import (
	"context"
	"strings"
	"testing"

	"github.com/tidwall/gjson"
)

func TestConvertOpenAIResponseToClaude_StreamReasoningFallbackField(t *testing.T) {
	t.Parallel()

	var param any
	originalReq := []byte(`{"stream":true}`)
	chunks := ConvertOpenAIResponseToClaude(
		context.Background(),
		"",
		originalReq,
		nil,
		[]byte(`data: {"id":"chatcmpl_1","model":"claude-opus-4.6","choices":[{"delta":{"reasoning":"reasoning from fallback field"}}]}`),
		&param,
	)
	joined := strings.Join(chunks, "")
	if !strings.Contains(joined, `"type":"thinking_delta"`) {
		t.Fatalf("stream output missing thinking_delta: %s", joined)
	}
	if !strings.Contains(joined, "reasoning from fallback field") {
		t.Fatalf("stream output missing fallback reasoning text: %s", joined)
	}
}

func TestConvertOpenAIResponseToClaude_StreamContentArrayReasoning(t *testing.T) {
	t.Parallel()

	var param any
	originalReq := []byte(`{"stream":true}`)
	chunks := ConvertOpenAIResponseToClaude(
		context.Background(),
		"",
		originalReq,
		nil,
		[]byte(`data: {"id":"chatcmpl_3","model":"claude-opus-4.6","choices":[{"delta":{"content":[{"type":"reasoning","summary":[{"type":"summary_text","text":"reasoning from summary"}]},{"type":"output_text","text":"final answer"}]}}]}`),
		&param,
	)
	joined := strings.Join(chunks, "")
	if !strings.Contains(joined, `"type":"thinking_delta"`) {
		t.Fatalf("stream output missing thinking_delta: %s", joined)
	}
	if !strings.Contains(joined, "reasoning from summary") {
		t.Fatalf("stream output missing reasoning text from summary: %s", joined)
	}
	if !strings.Contains(joined, `"type":"text_delta"`) || !strings.Contains(joined, "final answer") {
		t.Fatalf("stream output missing text delta from output_text block: %s", joined)
	}
}

func TestConvertOpenAIResponseToClaudeNonStream_ReasoningAndUsage(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
	  "id":"chatcmpl_2",
	  "model":"claude-opus-4.6",
	  "choices":[{"finish_reason":"stop","message":{"content":"answer","reasoning":"model reasoning"}}],
	  "usage":{
	    "prompt_tokens":120,
	    "completion_tokens":80,
	    "prompt_tokens_details":{"cached_tokens":20},
	    "completion_tokens_details":{"reasoning_tokens":33}
	  }
	}`)
	out := ConvertOpenAIResponseToClaudeNonStream(context.Background(), "", nil, nil, raw, nil)
	parsed := gjson.Parse(out)

	if thinking := parsed.Get(`content.#(type=="thinking").thinking`).Array(); len(thinking) == 0 || thinking[0].String() != "model reasoning" {
		t.Fatalf("missing thinking block from message.reasoning: %s", out)
	}
	if parsed.Get("usage.output_tokens_details.reasoning_tokens").Int() != 33 {
		t.Fatalf("reasoning tokens = %d, want 33", parsed.Get("usage.output_tokens_details.reasoning_tokens").Int())
	}
}

func TestConvertOpenAIResponseToClaudeNonStream_TopLevelReasoningSummary(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
	  "id":"chatcmpl_4",
	  "model":"claude-opus-4.6",
	  "choices":[{
	    "finish_reason":"stop",
	    "reasoning":{"summary":[{"type":"summary_text","text":"top level reasoning"}]},
	    "message":{"content":[{"type":"output_text","text":"ok"}]}
	  }]
	}`)
	out := ConvertOpenAIResponseToClaudeNonStream(context.Background(), "", nil, nil, raw, nil)
	parsed := gjson.Parse(out)

	if parsed.Get(`content.#(type=="thinking").thinking`).String() != "top level reasoning" {
		t.Fatalf("expected thinking from choices[0].reasoning.summary, got: %s", out)
	}
	if parsed.Get(`content.#(type=="text").text`).String() != "ok" {
		t.Fatalf("expected text from output_text block, got: %s", out)
	}
}
