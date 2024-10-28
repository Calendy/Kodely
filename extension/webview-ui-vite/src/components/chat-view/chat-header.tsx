// components/ChatHeader.tsx
import React, { memo } from "react"
import { ClaudeMessage, V1ClaudeMessage } from "../../../../src/shared/ExtensionMessage"
import TaskHeader from "../TaskHeader/TaskHeader"

interface ChatHeaderProps {
	task?: ClaudeMessage
	apiMetrics: V1ClaudeMessage["apiMetrics"]
	selectedModelSupportsPromptCache: boolean
	onClose: () => void
	isHidden: boolean
	koduCredits: number
	vscodeUriScheme: string
}

export const ChatHeader: React.FC<ChatHeaderProps> = ({
	task,
	apiMetrics,
	selectedModelSupportsPromptCache,
	onClose,
	isHidden,
	koduCredits,
	vscodeUriScheme,
}) => {
	if (!task) return null

	return (
		<TaskHeader
			task={task}
			tokensIn={apiMetrics?.inputTokens ?? 0}
			tokensOut={apiMetrics?.outputTokens ?? 0}
			doesModelSupportPromptCache={selectedModelSupportsPromptCache}
			cacheWrites={apiMetrics?.inputCacheWrite}
			cacheReads={apiMetrics?.inputCacheRead}
			totalCost={apiMetrics?.cost ?? 0}
			onClose={onClose}
			isHidden={isHidden}
			koduCredits={koduCredits}
			vscodeUriScheme={vscodeUriScheme}
		/>
	)
}
