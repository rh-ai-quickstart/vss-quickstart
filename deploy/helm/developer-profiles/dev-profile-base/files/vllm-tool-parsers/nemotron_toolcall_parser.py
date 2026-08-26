# SPDX-License-Identifier: Apache-2.0
#
# Nemotron tool-call parser for vLLM, registered as "nemotron_json".
#
# Adapted from nvidia/NVIDIA-Nemotron-Nano-9B-v2's shipped
# nemotron_toolcall_parser_no_streaming.py. Nemotron emits tool calls as
# <TOOLCALL>[{...}]</TOOLCALL> and no built-in vLLM parser matches that format.
# The upstream file hard-imports vLLM internals from paths that moved across
# releases (vllm.entrypoints.openai.protocol was split into chat_completion /
# engine sub-packages; tool parsers moved to the top-level vllm.tool_parsers
# package), so it fails to import on current builds. This copy resolves each
# symbol across the known layouts so it loads on old and current vLLM.
from __future__ import annotations

import json
import re
from importlib import import_module

from vllm.logger import init_logger

logger = init_logger(__name__)


def _resolve(name, *modules):
    """Return attribute `name` from the first of `modules` that provides it."""
    for mod in modules:
        try:
            m = import_module(mod)
        except Exception:
            continue
        if hasattr(m, name):
            return getattr(m, name)
    raise ImportError(f"could not resolve {name!r} from any of {modules}")


_PARSER_MODULES = (
    "vllm.tool_parsers.abstract_tool_parser",
    "vllm.tool_parsers",
    "vllm.entrypoints.openai.tool_parsers.abstract_tool_parser",
    "vllm.entrypoints.openai.tool_parsers",
)
_PROTOCOL_MODULES = (
    "vllm.entrypoints.openai.protocol",
    "vllm.entrypoints.openai.chat_completion.protocol",
    "vllm.entrypoints.openai.engine.protocol",
    "vllm.tool_parsers.abstract_tool_parser",
)

ToolParser = _resolve("ToolParser", *_PARSER_MODULES)
ToolParserManager = _resolve("ToolParserManager", *_PARSER_MODULES)
ToolCall = _resolve("ToolCall", *_PROTOCOL_MODULES)
FunctionCall = _resolve("FunctionCall", *_PROTOCOL_MODULES)
ExtractedToolCallInformation = _resolve(
    "ExtractedToolCallInformation", *_PARSER_MODULES, *_PROTOCOL_MODULES
)


@ToolParserManager.register_module("nemotron_json")
class NemotronJSONToolParser(ToolParser):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.tool_call_start_token = "<TOOLCALL>"
        self.tool_call_end_token = "</TOOLCALL>"
        self.tool_call_regex = re.compile(r"<TOOLCALL>(.*?)</TOOLCALL>", re.DOTALL)

    def extract_tool_calls(self, model_output, request):
        if self.tool_call_start_token not in model_output:
            return ExtractedToolCallInformation(
                tools_called=False, tool_calls=[], content=model_output
            )
        try:
            raw = self.tool_call_regex.findall(model_output)[0].strip()
            if not raw.startswith("["):
                raw = "[" + raw
            if not raw.endswith("]"):
                raw = raw + "]"
            tool_calls = []
            for call in json.loads(raw):
                try:
                    args = call["arguments"]
                    tool_calls.append(ToolCall(
                        type="function",
                        function=FunctionCall(
                            name=call["name"],
                            arguments=json.dumps(args, ensure_ascii=False)
                            if isinstance(args, dict) else args,
                        ),
                    ))
                except Exception:
                    continue
            content = model_output[:model_output.rfind(self.tool_call_start_token)]
            return ExtractedToolCallInformation(
                tools_called=True,
                tool_calls=tool_calls,
                content=content or None,
            )
        except Exception:
            logger.exception("Error extracting tool calls from: %s", model_output)
            return ExtractedToolCallInformation(
                tools_called=False, tool_calls=[], content=model_output
            )

    def extract_tool_calls_streaming(self, *args, **kwargs):
        raise NotImplementedError("Tool calling is not supported in streaming mode!")
