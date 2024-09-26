import { Anthropic } from "@anthropic-ai/sdk"
import axios, { CancelTokenSource } from "axios"
import { ApiHandler, ApiHandlerMessageResponse, withoutImageData } from "."
import { ApiHandlerOptions, koduDefaultModelId, KoduModelId, koduModels, ModelInfo } from "../shared/api"
import {
	getKoduConsultantUrl,
	getKoduCurrentUser,
	getKoduInferenceUrl,
	getKoduScreenshotUrl,
	getKoduVisitorUrl,
	getKoduWebSearchUrl,
	KODU_ERROR_CODES,
	KoduError,
	koduErrorMessages,
	koduSSEResponse,
} from "../shared/kodu"
import { z } from "zod"
import { AskConsultantResponseDto, WebSearchResponseDto } from "./interfaces"
import * as vscode from "vscode"
import { healMessages } from "./auto-heal"
const temperatures = {
	creative: {
		top_p: 0.8,
		tempature: 0.2,
	},
	normal: {},
	deterministic: {
		top_p: 0.9,
		tempature: 0.1,
	},
} as const

export async function fetchKoduUser({ apiKey }: { apiKey: string }) {
	console.log(`fetchKoduUser: ${getKoduCurrentUser()}`)
	const response = await axios.get(getKoduCurrentUser(), {
		headers: {
			"x-api-key": apiKey,
		},
		timeout: 5000,
	})
	console.log("response", response)
	if (response.data) {
		return {
			credits: Number(response.data.credits) ?? 0,
			id: response.data.id as string,
			email: response.data.email as string,
			isVisitor: response.data.isVisitor as boolean,
		}
	}
	return null
}

export async function initVisitor({ visitorId: vistorId }: { visitorId: string }) {
	const inputSchema = z.object({
		visitorId: z.string(),
	})
	const outputSchema = z.object({
		apiKey: z.string(),
		id: z.string(),
		balance: z.number(),
		credits: z.number(),
	})
	const response = await axios.post(getKoduVisitorUrl(), {
		vistorId: vistorId,
	})
	if (response.data) {
		console.log("response.data", response.data)
		const result = outputSchema.parse(response.data)
		return result
	}
	return null
}

export class KoduHandler implements ApiHandler {
	private options: ApiHandlerOptions
	private cancelTokenSource: CancelTokenSource | null = null

	constructor(options: ApiHandlerOptions) {
		this.options = options
	}

	async abortRequest(): Promise<void> {
		if (this.cancelTokenSource) {
			this.cancelTokenSource.cancel("Request aborted by user")
			this.cancelTokenSource = null
		}
	}

	async createMessage(
		systemPrompt: string,
		messages: Anthropic.Messages.MessageParam[],
		tools: Anthropic.Messages.Tool[],
		creativeMode: "normal" | "creative" | "deterministic",
		abortSignal?: AbortSignal,
		customInstructions?: string
	): Promise<ApiHandlerMessageResponse> {
		const modelId = this.getModel().id
		let requestBody: Anthropic.Beta.PromptCaching.Messages.MessageCreateParamsNonStreaming
		console.log(`creativeMode: ${creativeMode}`)
		const creativitySettings = temperatures[creativeMode]
		// check if the root of the folder has .kodu file if so read the content and use it as the system prompt
		let dotKoduFileContent = ""
		const workspaceFolders = vscode.workspace.workspaceFolders
		if (workspaceFolders) {
			for (const folder of workspaceFolders) {
				const dotKoduFile = vscode.Uri.joinPath(folder.uri, ".kodu")
				try {
					const fileContent = await vscode.workspace.fs.readFile(dotKoduFile)
					dotKoduFileContent = Buffer.from(fileContent).toString("utf8")
					console.log(".kodu file content:", dotKoduFileContent)
					break // Exit the loop after finding and reading the first .kodu file
				} catch (error) {
					console.log(`No .kodu file found in ${folder.uri.fsPath}`)
				}
			}
		}
		const system: Anthropic.Beta.PromptCaching.Messages.PromptCachingBetaTextBlockParam[] = [
			{ text: systemPrompt, type: "text", cache_control: { type: "ephemeral" } },
		]
		if (dotKoduFileContent) {
			system.push({
				text: dotKoduFileContent,
				type: "text",
				// cache_control: { type: "ephemeral" },
			})
		}
		if (customInstructions && customInstructions.trim()) {
			system.push({
				text: customInstructions,
				type: "text",
				cache_control: { type: "ephemeral" },
			})
		}

		switch (modelId) {
			case "claude-3-5-sonnet-20240620":
			case "claude-3-opus-20240229":
			case "claude-3-haiku-20240307":
				console.log("Matched anthropic cache model")
				const userMsgIndices = messages.reduce(
					(acc, msg, index) => (msg.role === "user" ? [...acc, index] : acc),
					[] as number[]
				)
				const lastUserMsgIndex = userMsgIndices[userMsgIndices.length - 1] ?? -1
				const secondLastMsgUserIndex = userMsgIndices[userMsgIndices.length - 2] ?? -1
				requestBody = {
					model: modelId,
					max_tokens: this.getModel().info.maxTokens,
					system,
					messages: healMessages(messages).map((message, index) => {
						if (index === lastUserMsgIndex || index === secondLastMsgUserIndex) {
							return {
								...message,
								content:
									typeof message.content === "string"
										? [
												{
													type: "text",
													text: message.content,
													cache_control: { type: "ephemeral" },
												},
										  ]
										: message.content.map((content, contentIndex) =>
												contentIndex === message.content.length - 1
													? { ...content, cache_control: { type: "ephemeral" } }
													: content
										  ),
							}
						}
						return message
					}),
					tools,
					tool_choice: { type: "auto" },
				}
				break
			default:
				console.log("Matched default model")
				requestBody = {
					model: modelId,
					max_tokens: this.getModel().info.maxTokens,
					system: [{ text: systemPrompt, type: "text" }],
					messages,
					tools,
					tool_choice: { type: "auto" },
					...creativitySettings,
				}
		}
		this.cancelTokenSource = axios.CancelToken.source()

		const response = await axios.post(
			getKoduInferenceUrl(),
			{
				...requestBody,
			},
			{
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.options.koduApiKey || "",
				},
				responseType: "stream",
				signal: abortSignal ?? undefined,
			}
		)

		if (response.status !== 200) {
			if (response.status in koduErrorMessages) {
				throw new KoduError({
					code: response.status as keyof typeof koduErrorMessages,
				})
			}
			throw new KoduError({
				code: KODU_ERROR_CODES.NETWORK_REFUSED_TO_CONNECT,
			})
		}

		if (response.data) {
			const reader = response.data
			const decoder = new TextDecoder("utf-8")
			let finalResponse: Extract<koduSSEResponse, { code: 1 }> | null = null
			let buffer = ""

			for await (const chunk of reader) {
				buffer += decoder.decode(chunk, { stream: true })
				const lines = buffer.split("\n\n")
				buffer = lines.pop() || ""

				for (const line of lines) {
					if (line.startsWith("data: ")) {
						const eventData = JSON.parse(line.slice(6)) as koduSSEResponse

						if (eventData.code === 0) {
							console.log("Health check received")
						} else if (eventData.code === 1) {
							finalResponse = eventData
							console.log("finalResponse", finalResponse)
							break
						} else if (eventData.code === -1) {
							throw new KoduError({
								code: eventData.body.status ?? KODU_ERROR_CODES.API_ERROR,
							})
						}
					}
				}

				if (finalResponse) {
					break
				}
			}

			if (!finalResponse) {
				throw new KoduError({
					code: KODU_ERROR_CODES.NETWORK_REFUSED_TO_CONNECT,
				})
			}

			return {
				message: finalResponse.body.anthropic,
				userCredits: finalResponse.body.internal.userCredits,
			}
		} else {
			throw new Error("No response data received")
		}
	}

	createUserReadableRequest(
		userContent: Array<
			| Anthropic.TextBlockParam
			| Anthropic.ImageBlockParam
			| Anthropic.ToolUseBlockParam
			| Anthropic.ToolResultBlockParam
		>
	): any {
		// if use udf
		return {
			model: this.getModel().id,
			max_tokens: this.getModel().info.maxTokens,
			system: "(see SYSTEM_PROMPT in src/agent/system-prompt.ts)",
			messages: [{ conversation_history: "..." }, { role: "user", content: withoutImageData(userContent) }],
			tools: "(see tools in src/agent/tools.ts)",
			tool_choice: { type: "auto" },
		}
	}

	getModel(): { id: KoduModelId; info: ModelInfo } {
		const modelId = this.options.apiModelId
		if (modelId && modelId in koduModels) {
			const id = modelId as KoduModelId
			return { id, info: koduModels[id] }
		}
		return { id: koduDefaultModelId, info: koduModels[koduDefaultModelId] }
	}

	async sendWebSearchRequest(searchQuery: string, baseLink: string): Promise<WebSearchResponseDto> {
		this.cancelTokenSource = axios.CancelToken.source()

		const response = await axios.post(
			getKoduWebSearchUrl(),
			{
				searchQuery,
				baseLink,
			},
			{
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.options.koduApiKey || "",
				},
				timeout: 60_000,
				cancelToken: this.cancelTokenSource?.token,
			}
		)

		return response.data
	}

	async sendUrlScreenshotRequest(url: string): Promise<Blob> {
		this.cancelTokenSource = axios.CancelToken.source()

		const response = await axios.post(
			getKoduScreenshotUrl(),
			{
				url,
			},
			{
				responseType: "arraybuffer",
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.options.koduApiKey || "",
				},
				timeout: 60_000,
				cancelToken: this.cancelTokenSource?.token,
			}
		)

		return new Blob([response.data], { type: "image/jpeg" })
	}

	async sendAskConsultantRequest(query: string): Promise<AskConsultantResponseDto> {
		this.cancelTokenSource = axios.CancelToken.source()

		const response = await axios.post(
			getKoduConsultantUrl(),
			{
				query,
			},
			{
				headers: {
					"Content-Type": "application/json",
					"x-api-key": this.options.koduApiKey || "",
				},
				timeout: 60_000,
				cancelToken: this.cancelTokenSource?.token,
			}
		)

		return response.data
	}
}
