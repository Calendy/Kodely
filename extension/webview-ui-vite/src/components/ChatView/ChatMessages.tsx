import React, { useRef, useEffect, useState, useCallback, useMemo } from "react"
import { Virtuoso, VirtuosoHandle } from "react-virtuoso"
import { ChevronDown } from "lucide-react"
import { ClaudeMessage, isV1ClaudeMessage, V1ClaudeMessage } from "../../../../src/shared/ExtensionMessage"
import { SyntaxHighlighterStyle } from "../../utils/getSyntaxHighlighterStyleFromTheme"
import ChatRow from "../ChatRow/ChatRow"
import ChatRowV1 from "../ChatRow/ChatRowV1"
import { Button } from "../ui/button"

interface ChatMessagesProps {
	visibleMessages: ClaudeMessage[]
	syntaxHighlighterStyle: SyntaxHighlighterStyle
	taskId: number
}

// Increased threshold for better bottom detection
const SCROLL_THRESHOLD = 33
const SCROLL_DEBOUNCE = 1

// Memoized message renderer component
const MessageRenderer = React.memo(
	({
		message,
		index,
		total,
		syntaxHighlighterStyle,
		nextMessage,
	}: {
		message: ClaudeMessage
		index: number
		total: number
		syntaxHighlighterStyle: SyntaxHighlighterStyle
		nextMessage?: ClaudeMessage
	}) => {
		const isLast = index === total - 1

		return isV1ClaudeMessage(message) ? (
			<ChatRowV1
				message={message}
				syntaxHighlighterStyle={syntaxHighlighterStyle}
				isLast={isLast}
				nextMessage={nextMessage as V1ClaudeMessage | undefined}
			/>
		) : (
			<ChatRow
				message={message}
				syntaxHighlighterStyle={syntaxHighlighterStyle}
				isLast={isLast}
				nextMessage={nextMessage}
			/>
		)
	}
)

MessageRenderer.displayName = "MessageRenderer"

const ChatMessages: React.FC<ChatMessagesProps> = ({ taskId, visibleMessages, syntaxHighlighterStyle }) => {
	const virtuosoRef = useRef<VirtuosoHandle>(null)
	const [atBottom, setAtBottom] = useState(true)
	const [userScrolled, setUserScrolled] = useState(false)
	const lastMessageCountRef = useRef(visibleMessages.length)
	const isInitialMount = useRef(true)
	const scrollTimeoutRef = useRef<NodeJS.Timeout>()

	// Memoize scroll handlers to prevent recreating on every render
	const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
		if (virtuosoRef.current) {
			virtuosoRef.current.scrollToIndex({
				index: "LAST",
				behavior: behavior === "auto" ? "auto" : "smooth",
				align: "end",
			})
			setUserScrolled(false)
			setAtBottom(true)
		}
	}, [])

	const followOutput = useCallback(() => {
		// More aggressive auto-scroll behavior
		if (!userScrolled || atBottom) {
			return "smooth"
		}
		return false
	}, [atBottom, userScrolled])

	// Debounced scroll handler
	const handleScroll = useCallback((event: Event) => {
		if (!event.isTrusted) return

		if (scrollTimeoutRef.current) {
			clearTimeout(scrollTimeoutRef.current)
		}

		scrollTimeoutRef.current = setTimeout(() => {
			setUserScrolled(true)
			isInitialMount.current = false
		}, SCROLL_DEBOUNCE)
	}, [])

	const handleAtBottomStateChange = useCallback((bottom: boolean) => {
		setAtBottom(bottom)
		if (bottom) {
			setUserScrolled(false)
		}
	}, [])

	// Handle new messages
	useEffect(() => {
		const newMessageCount = visibleMessages.length
		const messageAdded = newMessageCount > lastMessageCountRef.current

		if (!isInitialMount.current && messageAdded) {
			// More aggressive scroll behavior for new messages
			if (!userScrolled || atBottom) {
				scrollToBottom("smooth")
			}
		}

		lastMessageCountRef.current = newMessageCount
	}, [visibleMessages.length, atBottom, userScrolled, scrollToBottom])

	// Reset state when task changes
	useEffect(() => {
		isInitialMount.current = true
		setUserScrolled(false)
		setAtBottom(true)
		lastMessageCountRef.current = visibleMessages.length
		// Ensure we start at bottom for new tasks
		setTimeout(() => scrollToBottom(), 0)
	}, [taskId, visibleMessages.length, scrollToBottom])

	// Cleanup
	useEffect(() => {
		return () => {
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current)
			}
		}
	}, [])

	// Memoize scroll event handlers setup
	const scrollerRefCallback = useCallback(
		(ref: HTMLElement | Window | null) => {
			if (ref) {
				ref.addEventListener("wheel", handleScroll)
				ref.addEventListener("touchmove", handleScroll)
				ref.addEventListener("keydown", handleScroll)
				return () => {
					ref.removeEventListener("wheel", handleScroll)
					ref.removeEventListener("touchmove", handleScroll)
					ref.removeEventListener("keydown", handleScroll)
				}
			}
			return
		},
		[handleScroll]
	)

	// Memoize item content renderer
	const itemContent = useCallback(
		(index: number, message: ClaudeMessage) => (
			<div key={message.ts} className="mb-0">
				<MessageRenderer
					message={message}
					index={index}
					total={visibleMessages.length}
					syntaxHighlighterStyle={syntaxHighlighterStyle}
					nextMessage={index < visibleMessages.length - 1 ? visibleMessages[index + 1] : undefined}
				/>
			</div>
		),
		[visibleMessages, syntaxHighlighterStyle]
	)

	return (
		<div className="relative overflow-auto flex flex-col flex-1 ">
			<Virtuoso
				ref={virtuosoRef}
				data={visibleMessages}
				followOutput={followOutput}
				initialTopMostItemIndex={{
					index: "LAST",
					align: "end",
				}}
				atBottomStateChange={handleAtBottomStateChange}
				atBottomThreshold={SCROLL_THRESHOLD}
				scrollerRef={scrollerRefCallback}
				itemContent={itemContent}
				overscan={20}
				increaseViewportBy={{ top: 250, bottom: 250 }}
				// alignToBottom
				defaultItemHeight={100}
			/>
			{!atBottom && userScrolled && (
				<Button
					id="scroll-to-bottom"
					onClick={() => scrollToBottom("smooth")}
					size="icon"
					variant="secondary"
					className="fixed bottom-36 right-4 rounded-full shadow-lg hover:shadow-xl transition-shadow"
					aria-label="Scroll to bottom">
					<ChevronDown size={24} />
				</Button>
			)}
		</div>
	)
}

// Memoize the entire component
export default React.memo(ChatMessages, (prevProps, nextProps) => {
	return (
		prevProps.taskId === nextProps.taskId &&
		prevProps.visibleMessages === nextProps.visibleMessages &&
		prevProps.syntaxHighlighterStyle === nextProps.syntaxHighlighterStyle
	)
})
