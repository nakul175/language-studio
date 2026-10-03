# Open-source model and runtime notices

The on-device worker is served in source form at `/open-model-worker.js`, corresponding to `src/open-model-worker.js`. It is licensed GPL-3.0-or-later. Its imports fetch these dependencies directly; weights and upstream runtime binaries are not embedded in the application deployment.

| Component | License / source |
| --- | --- |
| Qwen2.5-0.5B-Instruct | Apache-2.0; [original model](https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct), [ONNX conversion](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct) |
| Whisper-base | MIT; [original model](https://huggingface.co/openai/whisper-base), [ONNX conversion](https://huggingface.co/onnx-community/whisper-base), [source](https://github.com/openai/whisper) |
| Transformers.js 3.8.1 | Apache-2.0; [source and license](https://github.com/huggingface/transformers.js) |
| ONNX Runtime Web, loaded by Transformers.js | MIT; [source and license](https://github.com/microsoft/onnxruntime) |
| eSpeak-NG Emscripten 0.3.5 | GPL-3.0; [wrapper/source/build instructions](https://github.com/echogarden-project/espeak-ng-emscripten), [engine fork](https://github.com/echogarden-project/espeak-ng/tree/fork), [upstream](https://github.com/espeak-ng/espeak-ng), [GPL text](https://www.gnu.org/licenses/gpl-3.0.html) |

Copyright remains with the respective authors. Preserve upstream license, copyright and source-availability requirements when vendoring or redistributing dependencies. System voices are supplied by the device, not distributed here. Other application dependencies and their licenses are recorded in package-lock.json and their respective packages.
