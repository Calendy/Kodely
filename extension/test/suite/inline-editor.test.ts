import * as vscode from "vscode"
import * as assert from "assert"
import { InlineEditHandler } from "../../src/integrations/editor/inline-editor"
import * as fs from "fs"
import * as path from "path"
import { parseDiffBlocks } from "@/agent/v1/tools/runners/coders/utils"

describe("InlineEditHandler End-to-End Test", () => {
	const testFilePath = path.join(__dirname, "testFile.ts")
	const toEditFilePath = path.join(__dirname, "toEditFile.txt")
	let inlineEditHandler: InlineEditHandler

	async function simulateStreaming(diff: string, delayMs: number): Promise<AsyncGenerator<string, void, unknown>> {
		// Get random chunk size between 6-24 chars
		function getRandomChunkSize() {
			return Math.floor(Math.random() * (24 - 6 + 1)) + 6
		}

		// Accumulate the string as we stream
		let streamedContent = ""

		async function* generator() {
			while (streamedContent.length < diff.length) {
				const chunkSize = getRandomChunkSize()
				const nextChunk = diff.slice(streamedContent.length, streamedContent.length + chunkSize)
				streamedContent += nextChunk
				yield streamedContent
				await delay(delayMs)
			}
		}

		return generator()
	}

	beforeEach(async () => {
		const toEditFileContent = fs.readFileSync(toEditFilePath, "utf8")
		// Create a dummy file for testing
		fs.writeFileSync(testFilePath, toEditFileContent, "utf8")

		// Open the file in VSCode
		const document = await vscode.workspace.openTextDocument(testFilePath)
		await vscode.window.showTextDocument(document)

		// Initialize InlineEditHandler
		inlineEditHandler = new InlineEditHandler()
	})

	afterEach(async () => {
		// Close all editors and delete the test file
		await vscode.commands.executeCommand("workbench.action.closeAllEditors")
		if (fs.existsSync(testFilePath)) {
			fs.unlinkSync(testFilePath)
		}
	})

	it("should handle streaming updates for a single code block", async () => {
		const search = `/*
We can't implement a dynamically updating sliding window as it would break prompt cache
every time. To maintain the benefits of caching, we need to keep conversation history
static. This operation should be performed as infrequently as possible. If a user reaches
a 200k context, we can assume that the first half is likely irrelevant to their current task.
Therefore, this function should only be called when absolutely necessary to fit within
context limits, not as a continuous process.
*/
export function truncateHalfConversation(
	messages: Anthropic.Messages.MessageParam[]
): Anthropic.Messages.MessageParam[] {
	if (!Array.isArray(messages) || messages.length < MIN_MESSAGES_TO_KEEP) {
		return messages
	}

	// Always keep the first Task message (this includes the project's file structure in potentially_relevant_details)
	const firstMessage = messages[0]

	// Calculate how many message pairs to remove (must be even to maintain user-assistant order)
	const messagePairsToRemove = Math.max(1, Math.floor((messages.length - MIN_MESSAGES_TO_KEEP) / 4)) * 2

	// Keep the first message and the remaining messages after truncation
	const remainingMessages = messages.slice(messagePairsToRemove + 1)

	// check if the first message exists appx twice if so pop the last instance and insert the first message again as last
	// if it doesn't exist twice, insert the first message as the last message

	return [firstMessage, ...remainingMessages]
}`
		const replace = `/*
we made this short on purpose
*/
export function truncateHalfConversation(
	messages: Anthropic.Messages.MessageParam[]
): Anthropic.Messages.MessageParam[] {
	// we added comment here
	if (!Array.isArray(messages) || messages.length < MIN_MESSAGES_TO_KEEP) {
		return messages
	}

	// we added another line of comment
	// Always keep the first Task message (this includes the project's file structure in potentially_relevant_details)
	const firstMessage = messages[0]

	// Calculate how many message pairs to remove (must be even to maintain user-assistant order)
	const messagePairsToRemove = Math.max(1, Math.floor((messages.length - MIN_MESSAGES_TO_KEEP) / 4)) * 2

	// this is the best way to see if this is working or is it actually bullshiting me
	// some more comments because why not
	// Keep the first message and the remaining messages after truncation
	const renamedMsgs = messages.slice(messagePairsToRemove + 1)

	return [firstMessage, ...renamedMsgs]
}`
		const diff1 = `SEARCH\n${search}\n=======\nREPLACE\n${replace}`

		const generator = await simulateStreaming(diff1, 50)
		let replaceContentFull = ""
		let isOpen = false
		let blockId: string[] = []
		for await (const diff of generator) {
			console.log(diff)
			try {
				const blocks = parseDiffBlocks(diff, toEditFilePath)
				if (blocks.length > 0 && blocks[0].replaceContent.length > 0) {
					if (blocks[0].replaceContent) {
						replaceContentFull = blocks[0].replaceContent
					}
					if (!isOpen) {
						const id = await inlineEditHandler.open(toEditFilePath, blocks[0].searchContent)
						if (!id) {
							console.warn(`Warning block not parsable yet`)
							continue
						}
						blockId.push(id)
						await inlineEditHandler.applyStreamContent(id, blocks[0].replaceContent)
						isOpen = true
					} else {
						await inlineEditHandler.applyStreamContent(blockId[0], blocks[0].replaceContent)
					}
				}
			} catch (err) {
				console.warn(`Warning block not parsable yet`)
			}
		}
		await inlineEditHandler.applyFinalContent(blockId[0], replaceContentFull)
		await delay(5_000)
		// save the file
		await inlineEditHandler.saveChanges(replaceContentFull)
		// sleep for like 15s
		await delay(60_000)

		// Verify final file content
		const document = vscode.window.activeTextEditor!.document
		const expectedContent = fs.readFileSync(toEditFilePath, "utf8").replace(search, replace)

		assert.strictEqual(document.getText(), expectedContent)
	})

	// 	it("should handle multiple code blocks and animations", async () => {
	// 		const diff1 = `
	// SEARCH
	// <div>
	// =======
	// REPLACE
	// <div className="container">`
	// 		const diff2 = `
	// SEARCH
	// <h1>Hello, world!</h1>
	// =======
	// REPLACE
	// <h1>Welcome to My App</h1>`
	// 		const diff3 = `
	// SEARCH
	// </div>
	// =======
	// REPLACE
	//     <p>Enjoy your stay!</p>
	// </div>`

	// 		// Simulate streaming updates for multiple blocks
	// 		await inlineEditHandler.handleDiffUpdate(diff1)
	// 		await delay(500) // Simulate streaming delay
	// 		await inlineEditHandler.handleDiffUpdate(diff2)
	// 		await delay(500) // Simulate streaming delay
	// 		await inlineEditHandler.handleDiffUpdate(diff3)

	// 		// Verify final file content
	// 		const document = vscode.window.activeTextEditor!.document
	// 		const expectedContent = `
	// import React from "react";

	// function App() {
	//     return (
	//         <div className="container">
	//             <h1>Welcome to My App</h1>
	//             <p>Enjoy your stay!</p>
	//         </div>
	//     );
	// }

	// export default App;
	// `
	// 		assert.strictEqual(document.getText(), expectedContent)
	// 	})
})

/**
 * Utility function to simulate delays (for streaming updates).
 */
function delay(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms))
}
