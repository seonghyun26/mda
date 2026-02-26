"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage } from "@/lib/types";
import ThinkingBlock from "./ThinkingBlock";
import ToolCallCard from "./ToolCallCard";

export default function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  return (
    <div className={`flex gap-3 px-4 py-3 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold ${
          isUser ? "bg-blue-600" : "bg-gradient-to-br from-orange-400 to-rose-500"
        }`}
      >
        {isUser ? "U" : "AI"}
      </div>

      {/* Content */}
      <div className={`max-w-[80%] space-y-1 ${isUser ? "items-end" : "items-start"} flex flex-col`}>
        {message.blocks.map((block, i) => {
          if (block.kind === "text") {
            return (
              <div
                key={i}
                className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                  isUser
                    ? "bg-blue-600 text-white"
                    : "bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100"
                }`}
              >
                {isUser ? (
                  <p className="whitespace-pre-wrap">{block.content}</p>
                ) : (
                  <div className="prose prose-sm dark:prose-invert max-w-none prose-pre:bg-gray-900 prose-pre:text-gray-100 prose-code:text-orange-600 dark:prose-code:text-orange-400">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {block.content}
                    </ReactMarkdown>
                  </div>
                )}
              </div>
            );
          }
          if (block.kind === "thinking") {
            return <ThinkingBlock key={i} block={block} />;
          }
          if (block.kind === "tool_call") {
            return <ToolCallCard key={block.tool_use_id} block={block} />;
          }
          if (block.kind === "error") {
            return (
              <div key={i} className="rounded-xl px-4 py-2.5 text-sm bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 text-red-700 dark:text-red-300">
                ⚠️ {block.content}
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}
