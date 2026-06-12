type ChatMessage = {
  from: "user" | "comadre";
  text: string;
};

// The animation contract in globals.css (chat-b1..chat-b4, typing-window)
// supports exactly 4 messages alternating user/comadre — hence the tuple.
type ChatScript = [ChatMessage, ChatMessage, ChatMessage, ChatMessage];

export function ChatDemo({
  emoji,
  title,
  ariaLabel,
  messages,
}: {
  emoji: string;
  title: string;
  ariaLabel: string;
  messages: ChatScript;
}) {
  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className="flex h-full flex-col rounded-2xl bg-olivo/10 p-5"
    >
      <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-olivo">
        <span aria-hidden="true">{emoji}</span> {title}
      </p>
      <div className="space-y-3">
        {messages.map((message, index) => (
          <p
            key={index}
            className={`chat-bubble chat-b${index + 1} w-fit max-w-[85%] rounded-2xl px-4 py-2 ${
              message.from === "user"
                ? "ml-auto rounded-br-sm bg-olivo text-papel"
                : "rounded-bl-sm bg-white"
            }`}
          >
            {message.text}
          </p>
        ))}
      </div>
      <p className="typing-line mt-auto flex items-center gap-1 pt-3 text-xs text-olivo">
        Comadre está escribiendo
        <i className="bg-barro" />
        <i className="bg-barro" />
        <i className="bg-barro" />
      </p>
    </div>
  );
}
