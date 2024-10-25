import { ToolResponse } from "../../types"
import { formatGenericToolFeedback, formatToolResponse } from "../../utils"
import { BaseAgentTool } from "../base-agent.tool"
import type { AgentToolOptions, AgentToolParams } from "../types"

export class WebSearchTool extends BaseAgentTool {
	protected params: AgentToolParams

	constructor(params: AgentToolParams, options: AgentToolOptions) {
		super(options)
		this.params = params
	}

	async execute(): Promise<ToolResponse> {
		const { say, ask, updateAsk, input } = this.params
		const { searchQuery, baseLink } = input

		if (!searchQuery) {
			await say("error", "Claude tried to use `web_search` without required parameter `searchQuery`. Retrying...")

			return `Error: Missing value for required parameter 'searchQuery'. Please retry with complete response.
				A good example of a web_search tool call is:
				{
					"tool": "web_search",
					"searchQuery": "How to import jotai in a react project",
					"baseLink": "https://jotai.org/docs/introduction"
				}
				Please try again with the correct searchQuery, you are not allowed to search without a searchQuery.`
		}

		const { response, text, images } = await ask(
			"tool",
			{
				tool: {
					tool: "web_search",
					searchQuery,
					baseLink,
					approvalState: "pending",
					ts: this.ts,
				},
			},
			this.ts
		)

		if (response !== "yesButtonTapped") {
			await updateAsk(
				"tool",
				{
					tool: {
						tool: "web_search",
						searchQuery,
						baseLink,
						approvalState: "rejected",
						ts: this.ts,
					},
				},
				this.ts
			)
		}
		if (response === "messageResponse") {
			await say("user_feedback", text, images)
			return formatToolResponse(formatGenericToolFeedback(text), images)
		}

		try {
			await updateAsk(
				"tool",
				{
					tool: {
						tool: "web_search",
						searchQuery,
						baseLink,
						approvalState: "loading",
						ts: this.ts,
					},
				},
				this.ts
			)

			const result = this.koduDev
				.getApiManager()
				.getApi()
				?.sendWebSearchRequest?.(searchQuery, baseLink)

			if (!result) {
				throw new Error("Unable to read response")
			}

			let fullContent = ""
			for await (const chunk of result) {
				fullContent += chunk.content
				await updateAsk(
					"tool",
					{
						tool: {
							tool: "web_search",
									searchQuery,
							baseLink,
							content: chunk.content,
							streamType: chunk.type,
							approvalState: "loading",
							ts: this.ts,
						},
							},
							this.ts
						)
			}

			return `Web search completed. Full content: ${fullContent}`
		} catch (err) {
			await updateAsk(
				"tool",
				{
					tool: {
						tool: "web_search",
						searchQuery: searchQuery ?? "",
						baseLink: baseLink ?? "",
						approvalState: "error",
						error: `${err}`,
						ts: this.ts,
					},
				},
				this.ts
			)
			return `Web search failed with error: ${err}`
		}
	}
}
