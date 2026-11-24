import { forwardRef, useSyncExternalStore, type ComponentPropsWithoutRef } from "react"

import { ChatTextArea } from "./ChatTextArea"
import type { createChatDraft } from "./chatDraft"

type ChatComposerProps = Omit<
	ComponentPropsWithoutRef<typeof ChatTextArea>,
	"inputValue" | "setInputValue" | "setInputValueGenerated" | "getInputSegments" | "setInputValueWithSegments"
> & { draft: ReturnType<typeof createChatDraft> }

export const ChatComposer = forwardRef<HTMLTextAreaElement, ChatComposerProps>(function ChatComposer(
	{ draft, ...props },
	ref,
) {
	const text = useSyncExternalStore(draft.subscribe, draft.getText)

	return (
		<ChatTextArea
			{...props}
			ref={ref}
			inputValue={text}
			setInputValue={draft.edit}
			setInputValueGenerated={draft.replaceWithGenerated}
			getInputSegments={draft.getSegments}
			setInputValueWithSegments={draft.replace}
		/>
	)
})
