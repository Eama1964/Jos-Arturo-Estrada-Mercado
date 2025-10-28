import React, { useState } from 'react';
import { IconSend, IconLoader } from './IconComponents';

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  isLoading: boolean;
}

const ChatInput: React.FC<ChatInputProps> = ({ onSendMessage, isLoading }) => {
  const [input, setInput] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() && !isLoading) {
      onSendMessage(input.trim());
      setInput('');
    }
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="relative flex items-center">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un mensaje a Mary Jose..."
          disabled={isLoading}
          className="w-full pl-5 pr-14 py-3.5 bg-gray-800/80 border border-gray-600 text-white rounded-full focus:outline-none focus:ring-2 focus:ring-purple-500 backdrop-blur-sm transition-shadow"
          aria-label="Chat message input"
        />
        <button
          type="submit"
          disabled={isLoading || !input.trim()}
          className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center justify-center h-10 w-10 rounded-full text-white bg-purple-600 hover:bg-purple-700 disabled:bg-gray-500 disabled:cursor-not-allowed transition-colors"
          aria-label="Send message"
        >
          {isLoading ? <IconLoader className="h-5 w-5 animate-spin" /> : <IconSend className="h-5 w-5" />}
        </button>
      </form>
    </div>
  );
};

export default ChatInput;