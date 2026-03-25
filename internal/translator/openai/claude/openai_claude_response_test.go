package claude

import (
	"context"
	"strings"
	"testing"

	"github.com/tidwall/gjson"
)

func TestConvertOpenAIResponseToClaude_StreamReasoningContentField(t *testing.T) {
	t.Parallel()

	var param any
	originalReq := []byte(`{"stream":true}`)
	chunks := ConvertOpenAIResponseToClaude(
		context.Background(),
		"",
		originalReq,
		nil,
		[]byte(`data: {"id":"chatcmpl_1","model":"claude-opus-4.6","choices":[{"delta":{"reasoning_content":"reasoning from content field"}}]}`),
		&param,
	)
	joined := joinBytes(chunks)
	if !strings.Contains(joined, `"type":"thinking_delta"`) {
		t.Fatalf("stream output missing thinking_delta: %s", joined)
	}
	if !strings.Contains(joined, "reasoning from content field") {
		t.Fatalf("stream output missing reasoning text: %s", joined)
	}
}

func TestConvertOpenAIResponseToClaudeNonStream_ReasoningContentAndUsage(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
	  "id":"chatcmpl_2",
	  "model":"claude-opus-4.6",
	  "choices":[{"finish_reason":"stop","message":{"content":"answer","reasoning_content":"model reasoning"}}],
	  "usage":{
	    "prompt_tokens":120,
	    "completion_tokens":80,
	    "prompt_tokens_details":{"cached_tokens":20},
	    "completion_tokens_details":{"reasoning_tokens":33}
	  }
	}`)
	out := ConvertOpenAIResponseToClaudeNonStream(context.Background(), "", nil, nil, raw, nil)
	parsed := gjson.ParseBytes(out)

	if thinking := parsed.Get(`content.#(type=="thinking").thinking`).Array(); len(thinking) == 0 || thinking[0].String() != "model reasoning" {
		t.Fatalf("missing thinking block from message.reasoning_content: %s", out)
	}
}

func TestConvertOpenAIResponseToClaudeNonStream_ContentArrayReasoning(t *testing.T) {
	t.Parallel()

	raw := []byte(`{
	  "id":"chatcmpl_4",
	  "model":"claude-opus-4.6",
	  "choices":[{
	    "finish_reason":"stop",
	    "message":{"content":[{"type":"reasoning","text":"top level reasoning"},{"type":"text","text":"ok"}]}
	  }]
	}`)
	out := ConvertOpenAIResponseToClaudeNonStream(context.Background(), "", nil, nil, raw, nil)
	parsed := gjson.ParseBytes(out)

	if parsed.Get(`content.#(type=="thinking").thinking`).String() != "top level reasoning" {
		t.Fatalf("expected thinking from content array reasoning, got: %s", out)
	}
	if parsed.Get(`content.#(type=="text").text`).String() != "ok" {
		t.Fatalf("expected text from content array, got: %s", out)
	}
}

func joinBytes(chunks [][]byte) string {
	var b strings.Builder
	for _, c := range chunks {
		b.Write(c)
	}
	return b.String()
}
