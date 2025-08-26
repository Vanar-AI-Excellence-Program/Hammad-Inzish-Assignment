<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { browser } from '$app/environment';

  export let data: {
    user: { id: string; name?: string | null; email?: string | null; role?: string | null };
    chats: any[];
    messages: any[];
  };

  type Message = { id: string; role: 'user' | 'assistant'; content: string; timestamp: Date; parentId?: string | null };
  type Chat = { id: string; title: string; messages: Message[]; createdAt: Date };

  let chats: Chat[] = [];
  let activeChat: Chat | null = null;
  let input = '';
  let loading = false;
  let error: string | null = null;
  let abortController: AbortController | null = null;

  let renamingChatId: string | null = null;
  let renameInput = '';
  let editingMessageId: string | null = null;
  let editInput = '';
  let editingMessage: Message | null = null;
  let selectedBranchId: string | null = null; // Current branch being displayed
  let availableBranches: { id: string; preview: string; messageCount: number }[] = []; // Available branches

  // Minimal action to inject trusted HTML (generated locally)
  export function setHtml(node: HTMLElement, params: { html: string }) {
    const set = (html: string) => {
      node.innerHTML = html;
    };
    set(params?.html || '');
    return {
      update(next: { html: string }) {
        set(next?.html || '');
      }
    };
  }



  function renderMarkdownLite(src: string): string {
    let text = src || '';
    
    // Headers (# ## ###)
    text = text.replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>');
    text = text.replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>');
    
         // Code fences ```lang\ncode\n``` with syntax highlighting
     text = text.replace(/```([a-zA-Z0-9+-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
       const cls = lang ? ` class="language-${lang}"` : '';
       const langLabel = lang ? `<div class="text-xs text-gray-300 mb-2 font-mono bg-gray-700 px-2 py-1 rounded">${lang}</div>` : '';
       const escapedCode = code.trim()
         .replace(/&/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;');
       return `<div class="bg-gray-900 text-gray-100 rounded-lg p-4 my-4 overflow-x-auto border border-gray-600 shadow-lg" style="background-color: rgb(17 24 39) !important; color: rgb(229 231 235) !important;"><pre class="bg-gray-900 text-gray-100" style="background-color: rgb(17 24 39) !important; color: rgb(229 231 235) !important;"><code${cls}>${langLabel}${escapedCode}</code></pre></div>`;
     });
     
     // Inline code `code`
     text = text.replace(/`([^`]+)`/g, (_m, code) => {
       const escapedCode = code
         .replace(/&/g, '&amp;')
         .replace(/</g, '&lt;')
         .replace(/>/g, '&gt;');
       return `<code class="bg-gray-800 text-gray-100 px-2 py-1 rounded text-sm font-mono border border-gray-600" style="background-color: rgb(31 41 55) !important; color: rgb(229 231 235) !important;">${escapedCode}</code>`;
     });
    
    // Bold **text** and __text__
    text = text.replace(/\*\*(.*?)\*\*/g, '<strong class="font-bold">$1</strong>');
    text = text.replace(/__(.*?)__/g, '<strong class="font-bold">$1</strong>');
    
    // Italic *text* and _text_
    text = text.replace(/\*(.*?)\*/g, '<em class="italic">$1</em>');
    text = text.replace(/_(.*?)_/g, '<em class="italic">$1</em>');
    
    // Strikethrough ~~text~~
    text = text.replace(/~~(.*?)~~/g, '<del class="line-through">$1</del>');
    
    // Links [text](url)
    text = text.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-blue-600 hover:text-blue-800 underline" target="_blank" rel="noopener noreferrer">$1</a>');
    
    // Unordered lists (- * +)
    text = text.replace(/^[\s]*[-*+][\s]+(.*)/gim, '<li class="ml-4">$1</li>');
    text = text.replace(/(<li.*<\/li>)/s, '<ul class="list-disc ml-6 my-2">$1</ul>');
    
    // Ordered lists (1. 2. 3.)
    text = text.replace(/^[\s]*\d+\.[\s]+(.*)/gim, '<li class="ml-4">$1</li>');
    text = text.replace(/(<li.*<\/li>)/s, '<ol class="list-decimal ml-6 my-2">$1</ol>');
    
    // Blockquotes (> text)
    text = text.replace(/^> (.*$)/gim, '<blockquote class="border-l-4 border-blue-500 pl-4 my-4 italic text-gray-700 bg-blue-50 p-4 rounded-lg">$1</blockquote>');
    
    // Horizontal rules (---, ***, ___)
    text = text.replace(/^[\s]*[-*_]{3,}[\s]*$/gim, '<hr class="my-4 border-blue-500 opacity-70">');
    
    // Tables (basic support)
    text = text.replace(/\|(.+)\|/g, (match, content) => {
      const cells = content.split('|').map(cell => `<td class="border border-gray-300 px-3 py-2">${cell.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    });
    text = text.replace(/(<tr>.*<\/tr>)/s, '<table class="border-collapse border border-gray-300 my-4 w-full">$1</table>');
    
    // Simple paragraphs/line breaks
    const lines = text.split('\n');
    const processedLines = lines.map(line => {
      line = line.trim();
      // Skip lines that are already HTML tags
      if (line.startsWith('<') && line.endsWith('>')) {
        return line;
      }
      // Skip empty lines
      if (!line) {
        return '<br>';
      }
      // Skip list items, headers, blockquotes, etc. that are already processed
      if (line.startsWith('<li>') || line.startsWith('<h') || line.startsWith('<blockquote>') || 
          line.startsWith('<hr>') || line.startsWith('<table>') || line.startsWith('<div>')) {
        return line;
      }
      // Regular paragraph
      return `<p class="mb-2">${line}</p>`;
    });
    
    return processedLines.join('');
  }

  // Auto-scroll to bottom
  let messagesContainer: HTMLDivElement;

  onMount(() => {
    // Convert DB data to local format
    if (data.chats && data.chats.length > 0) {
      chats = data.chats.map((chat: any) => ({
        id: chat.id,
        title: chat.title,
        createdAt: new Date(chat.createdAt),
        messages: chat.messages ? chat.messages.map((msg: any) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.createdAt),
          parentId: msg.parentId
        })) : []
      }));
      
      // Set the first chat as active
      activeChat = chats[0];
      
             // Initialize branches for the first chat
       if (activeChat && activeChat.messages.length > 0) {
         availableBranches = getAvailableBranches(activeChat.messages);
         if (availableBranches.length > 0) {
           selectedBranchId = availableBranches[0].id; // Default to first branch
         }
       }
    } else {
      createNewChat();
    }
  });

  async function createNewChat() {
    const newChat: Chat = {
      id: crypto.randomUUID(),
      title: 'New Chat',
      messages: [],
      createdAt: new Date()
    };
    chats = [newChat, ...chats];
    activeChat = newChat;
    
    // Clear branch check cache for new chat
    branchCheckCache.clear();
    
    // Save to DB
    try {
      await fetch('/api/chat/create', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: newChat.id, title: newChat.title })
      });
      
      // Refresh chats to get the updated data from the server
      await refreshChats();
    } catch (error) {
      console.error('Failed to create chat:', error);
    }
  }

  async function selectChat(chat: Chat) {
    activeChat = null;
    // force DOM reset before setting the new chat to ensure formatting action runs
    setTimeout(async () => {
      // Load messages for the selected chat only if they haven't been loaded yet
      if (!chat.messages || chat.messages.length === 0) {
        try {
          const response = await fetch(`/api/chat/message?chatId=${chat.id}`);
          if (response.ok) {
            const data = await response.json();
            if (data.success && data.messages) {
              chat.messages = data.messages.map((msg: any) => ({
                id: msg.id,
                role: msg.role,
                content: msg.content,
                timestamp: new Date(msg.createdAt),
                parentId: msg.parentId
              }));
            } else {
              chat.messages = [];
            }
          } else {
            console.error('Failed to load messages for chat:', chat.id);
            chat.messages = [];
          }
        } catch (error) {
          console.error('Error loading messages:', error);
          chat.messages = [];
        }
      }
      
      activeChat = chat;
      
      // Initialize branches for the selected chat
      if (activeChat.messages.length > 0) {
        availableBranches = getAvailableBranches(activeChat.messages);
        if (availableBranches.length > 0) {
          selectedBranchId = availableBranches[0].id; // Default to first branch
        } else {
          selectedBranchId = null;
        }
      } else {
        availableBranches = [];
        selectedBranchId = null;
      }
      
      // Clear branch check cache when switching chats
      branchCheckCache.clear();
      
      // ensure we scroll to bottom of the newly selected chat
      scrollToBottom();
    }, 0);
  }

  async function deleteChat(chatId: string) {
    chats = chats.filter(c => c.id !== chatId);
    if (activeChat?.id === chatId) {
      activeChat = chats[0] || null;
      if (!activeChat) {
        createNewChat();
      }
    }
    
    // Delete from DB
    try {
      await fetch('/api/chat/delete', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: chatId })
      });
      
      // Refresh chats to get the updated data from the server
      await refreshChats();
    } catch (e) {
      console.error('Failed to delete chat:', e);
    }
  }

  async function refreshChats() {
    try {
      const response = await fetch('/chat');
      if (response.ok) {
        const html = await response.text();
        // Parse the HTML to extract the data
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const scriptTag = doc.querySelector('script[data-sveltekit-hydrate]');
        if (scriptTag) {
          const dataMatch = scriptTag.textContent?.match(/window\.__sveltekit_1\s*=\s*({.*?});/s);
          if (dataMatch) {
            try {
              const newData = JSON.parse(dataMatch[1]);
              if (newData.chats) {
                chats = newData.chats.map((chat: any) => ({
                  id: chat.id,
                  title: chat.title,
                  createdAt: new Date(chat.createdAt),
                  messages: chat.messages ? chat.messages.map((msg: any) => ({
                    id: msg.id,
                    role: msg.role,
                    content: msg.content,
                    timestamp: new Date(msg.createdAt),
                    parentId: msg.parentId
                  })) : []
                }));
                
                // Update active chat if it still exists
                if (activeChat) {
                  const updatedActiveChat = chats.find(c => c.id === activeChat.id);
                  if (updatedActiveChat) {
                    activeChat = updatedActiveChat;
                                         // Refresh branches for the updated chat
                     if (activeChat.messages.length > 0) {
                       availableBranches = getAvailableBranches(activeChat.messages);
                       if (availableBranches.length > 0) {
                         selectedBranchId = availableBranches[0].id; // Default to first branch
                       }
                     }
                  } else if (chats.length > 0) {
                    activeChat = chats[0];
                                         // Initialize branches for the new active chat
                     if (activeChat.messages.length > 0) {
                       availableBranches = getAvailableBranches(activeChat.messages);
                       if (availableBranches.length > 0) {
                         selectedBranchId = availableBranches[0].id; // Default to first branch
                       }
                     }
                  }
                }
              }
            } catch (e) {
              console.error('Failed to parse chat data:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Error refreshing chats:', error);
    }
  }




  async function sendMessage() {
    const text = input.trim();
    if (!text || loading || !activeChat) return;
    
    console.log('Sending message with text:', text);
    console.log('Active chat messages count:', activeChat.messages.length);
    
    input = '';
    error = null;

    const userMsg: Message = { 
      id: crypto.randomUUID(), 
      role: 'user', 
      content: text,
      timestamp: new Date()
    };

    console.log('Created userMsg:', userMsg);

    // Update chat title if it's the first message
    if (activeChat.messages.length === 0) {
      activeChat.title = text.length > 50 ? text.substring(0, 50) + '...' : text;
    }

         // compute parent for tree fork
     let parentId = activeChat.messages.length > 0 ? activeChat.messages[activeChat.messages.length - 1].id : null;
     
     // If we're in a specific branch, ensure new messages continue from that branch
     if (selectedBranchId) {
       // Find the last message in the current branch
       const currentBranchMessages = getCurrentBranchMessages();
       if (currentBranchMessages.length > 0) {
         const lastMessageInBranch = currentBranchMessages[currentBranchMessages.length - 1];
         if (lastMessageInBranch && lastMessageInBranch.id !== parentId) {
           // Update parent to continue from the current branch
           parentId = lastMessageInBranch.id;
         }
       }
     }

    loading = true;
    scrollToBottom();
    
    // Create new AbortController for this request
    abortController = new AbortController();

    try {
             // Build branch context for messages
       const branchMessages = (() => {
         // Normal linear conversation - send all messages plus the new user message
         const allMessages = [...activeChat.messages, userMsg];
         console.log('Normal conversation - all messages:', allMessages.map(m => ({ role: m.role, content: m.content.substring(0, 50) })));
         return allMessages.map(({ role, content }) => ({ role, content, chatId: activeChat.id }));
       })();

      console.log('Branch messages before validation:', branchMessages);

      // Validate messages before sending
      const validBranchMessages = branchMessages.filter(msg => 
        msg && 
        typeof msg === 'object' && 
        typeof msg.role === 'string' && 
        ['user', 'assistant', 'system'].includes(msg.role) &&
        typeof msg.content === 'string' && 
        msg.content.trim().length > 0
      );

      console.log('Valid branch messages after filtering:', validBranchMessages);

      if (validBranchMessages.length === 0) {
        console.error('No valid messages to send. Branch messages:', branchMessages);
        throw new Error('No valid messages to send');
      }

      // Ensure at least one user message exists
      const hasUserMessage = validBranchMessages.some(msg => msg.role === 'user');
      if (!hasUserMessage) {
        console.error('No user message found in valid messages:', validBranchMessages);
        throw new Error('At least one user message is required');
      }

      console.log('Sending messages:', validBranchMessages.length, 'valid messages');

      // Add the user message to the chat now that we have the context
      const userMessageWithParent = { ...userMsg, parentId };
      activeChat.messages = [...activeChat.messages, userMessageWithParent];
      chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
      
      

             const res = await fetch('/api/chat', {
         method: 'POST',
         body: JSON.stringify({ messages: validBranchMessages }),
         headers: { 'content-type': 'application/json' },
         signal: abortController.signal
       });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to get response');
      }

      // Set all flags to prevent branch checking during response generation
      isStreaming = true;
      isUpdatingUI = true;
      isGeneratingResponse = true;
      
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      
      // Add placeholder message for streaming
      const assistantId = crypto.randomUUID();
      const assistantMsg: Message = { 
        id: assistantId, 
        role: 'assistant', 
        content: '',
        timestamp: new Date(),
        parentId: userMsg.id
      };
      
      activeChat.messages = [...activeChat.messages, assistantMsg];
      chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');
          
          for (const line of lines) {
            const m = line.match(/^0:(.*)$/);
            if (m) {
              try {
                const decoded = JSON.parse(m[1]);
                assistantText += decoded;
                activeChat.messages = activeChat.messages.map((msg) =>
                  msg.id === assistantId ? { ...msg, content: assistantText } : msg
                );
                chats = chats.map((c) => (c.id === activeChat?.id ? activeChat : c));
                scrollToBottom();
              } catch (_) {
                // ignore malformed lines
              }
            }
          }
        }
      }

      // Save messages to DB
      try {
        await fetch('/api/chat/message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: userMsg.id,
            chatId: activeChat.id,
            parentId: parentId, // Use the computed parentId
            role: userMsg.role,
            content: userMsg.content
          })
        });
        
        await fetch('/api/chat/message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: assistantId,
            chatId: activeChat.id,
            parentId: userMsg.id,
            role: 'assistant',
            content: assistantText
          })
        });
        
        // Clear branch check cache to ensure fresh results after new message
        branchCheckCache.clear();
        
        // Check for branches using the updated local state
        if (activeChat) {
          // Set UI update flag to prevent branch checking during re-render
          isUpdatingUI = true;
          
          // Check for siblings using the updated local state
          const rootMessages = activeChat.messages.filter(msg => !msg.parentId);
          const hasSiblings = rootMessages.length > 1;
          
          if (hasSiblings) {
            // Create branches from local state
            availableBranches = rootMessages.map(root => ({
              id: root.id,
              preview: root.content.length > 50 ? root.content.substring(0, 50) + '...' : root.content,
              messageCount: getBranchMessageCount(activeChat.messages, root.id)
            }));
          } else {
            availableBranches = [];
          }
          
          // Force a re-render to show navigation buttons
          activeChat = { ...activeChat };
          chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
          
          // Clear UI update flag after re-render is complete
          setTimeout(() => {
            isUpdatingUI = false;
          }, 50);
        }
      } catch (e) {
        console.error('Failed to save messages:', e);
      }

      
    } catch (e: any) {
      if (e.name === 'AbortError') {
        // Request was aborted by user
        console.log('Request was aborted by user');
        error = null;
      } else {
        error = e?.message ?? 'Unknown error';
      }
    } finally {
      loading = false;
      abortController = null;
      isStreaming = false; // Reset streaming flag
      isUpdatingUI = false; // Reset UI update flag
      isGeneratingResponse = false; // Reset response generation flag
    }
  }

  function scrollToBottom() {
    setTimeout(() => {
      if (messagesContainer) {
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
      }
    }, 10);
  }

  function stopResponse() {
    if (abortController) {
      abortController.abort();
      abortController = null;
    }
    loading = false;
    error = null;
  }

  // After initial mount or refresh, jump to bottom if there are messages
  let didInitialScroll = false;
  afterUpdate(() => {
    if (!didInitialScroll && activeChat && activeChat.messages.length > 0) {
      scrollToBottom();
      didInitialScroll = true;
    }
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
    
    // Branch navigation keyboard shortcuts
    if (e.ctrlKey || e.metaKey) {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        selectPreviousBranch();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        selectNextBranch();
      }
    }
  }



  function formatTime(date: Date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }



  function startRename(c: Chat) {
    renamingChatId = c.id;
    renameInput = c.title;
  }

  async function confirmRename(c: Chat) {
    const title = renameInput.trim();
    renamingChatId = null;
    if (!title || c.title === title) return;

    c.title = title;
    chats = chats.map((x) => (x.id === c.id ? { ...x, title } : x));

    try {
      await fetch('/api/chat/rename', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: c.id, title })
      });
      
      // Refresh chats to get the updated data from the server
      await refreshChats();
    } catch (e) {
      console.error('Failed to rename chat:', e);
    }
  }

  function startEditMessage(msg: Message) {
    editingMessageId = msg.id;
    editingMessage = msg;
    editInput = msg.content;
    
    // Auto-select the branch containing this message
    if (activeChat) {
      // Find which branch this message belongs to
      let messageBranchId = null;
      
      // If message has no parent, it's a root message
      if (!msg.parentId) {
        messageBranchId = msg.id;
      } else {
        // Find the root message of this branch
        let current = msg;
        while (current.parentId) {
          const parent = activeChat.messages.find(m => m.id === current.parentId);
          if (parent) {
            current = parent;
          } else {
            break;
          }
        }
        messageBranchId = current.id;
      }
      
      if (messageBranchId) {
        selectedBranchId = messageBranchId;
      }
    }
  }

    async function confirmEdit() {
    if (!editingMessage || !activeChat || !editInput.trim()) return;
    
    const newContent = editInput.trim();
    if (newContent === editingMessage.content) {
      editingMessageId = null;
      editingMessage = null;
      editInput = '';
      return;
    }

    // Don't switch branches when editing - stay on current branch
    // The edited message will replace the original and show the new response
    
    // Store the message ID before clearing edit state
    const messageIdToEdit = editingMessage.id;
    
    // Clear edit state immediately
    editingMessageId = null;
    editingMessage = null;
    editInput = '';

    try {
      // Find the original message being edited
      const originalMessage = activeChat.messages.find(m => m.id === messageIdToEdit);
      if (!originalMessage) return;
      
      // Create the edited message as a SIBLING (same parent as original)
      const editedMsg: Message = {
        id: crypto.randomUUID(),
        role: 'user',
        content: newContent,
        timestamp: new Date(),
        parentId: originalMessage.parentId // Same parent - this makes them siblings!
      };

      // Add the edited message to the chat (keeping original message)
      activeChat.messages = [...activeChat.messages, editedMsg];
      chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
      
      // Clear branch check cache to ensure fresh results after edit
      branchCheckCache.clear();
      
      // Immediately check for siblings and update available branches
      const messagesWithSameParent = activeChat.messages.filter(m => m.parentId === originalMessage.parentId);
      if (messagesWithSameParent.length > 1) {
        // We now have siblings! Update available branches
        const rootMessages = activeChat.messages.filter(msg => !msg.parentId);
        availableBranches = rootMessages.map(root => ({
          id: root.id,
          preview: root.content.length > 50 ? root.content.substring(0, 50) + '...' : root.content,
          messageCount: getBranchMessageCount(activeChat.messages, root.id)
        }));
        
        // Set the edited message as the selected branch
        selectedBranchId = editedMsg.id;
        

      }
      
      // Force a re-render to show the navigation buttons immediately
      activeChat = { ...activeChat };
      chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
      
      // Scroll to bottom to show the edited message
      scrollToBottom();
      
      // Note: The edited message now replaces the original in the current branch
      // The AI response will be added below it, creating a new conversation flow

      // Now get the AI response with streaming
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: [{
            role: 'user',
            content: newContent,
            chatId: activeChat.id
          }]
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

      // Add placeholder message for streaming
      const assistantId = crypto.randomUUID();
      const assistantMsg: Message = {
        id: assistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        parentId: editedMsg.id
      };

      activeChat.messages = [...activeChat.messages, assistantMsg];
      chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);

      // Set all flags to prevent branch checking during response generation
      isStreaming = true;
      isUpdatingUI = true;
      isGeneratingResponse = true;
      
      // Stream the response
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';

      if (reader) {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const chunk = decoder.decode(value, { stream: true });
          const lines = chunk.split('\n');

          for (const line of lines) {
            const m = line.match(/^0:(.*)$/);
            if (m) {
              try {
                const decoded = JSON.parse(m[1]);
                assistantText += decoded;
                activeChat.messages = activeChat.messages.map((msg) =>
                  msg.id === assistantId ? { ...msg, content: assistantText } : msg
                );
                chats = chats.map((c) => (c.id === activeChat?.id ? activeChat : c));
                scrollToBottom();
              } catch (_) {
                // ignore malformed lines
              }
            }
          }
        }
      }

      // Save messages to DB
      try {
        // Save the edited message as a new sibling
        await fetch('/api/chat/message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: editedMsg.id,
            chatId: activeChat.id,
            parentId: editedMsg.parentId, // Same parent as original = sibling
            role: editedMsg.role,
            content: editedMsg.content
          })
        });

        // Save the AI response as child of the edited message
        await fetch('/api/chat/message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: assistantId,
            chatId: activeChat.id,
            parentId: editedMsg.id, // Child of edited message
            role: 'assistant',
            content: assistantText
          })
        });
        
        // Response generation complete, reset all flags
        isStreaming = false;
        isGeneratingResponse = false;
        isUpdatingUI = false;
        
        // The messages are already in the local state, just need to force a re-render
        // to ensure the navigation buttons appear
        activeChat = { ...activeChat };
        chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
        

        
      } catch (e) {
        console.error('Failed to save messages:', e);
      }

    } catch (e) {
      console.error('Error editing message:', e);
    }
  }

  function cancelEdit() {
    editingMessageId = null;
    editingMessage = null;
    editInput = '';
  }

  // Branch management functions - simplified
  function getAvailableBranches(messages: Message[]): { id: string; preview: string; messageCount: number }[] {
    if (!messages || messages.length === 0) return [];
    
    // Find root messages (messages with no parent)
    const rootMessages = messages.filter(msg => !msg.parentId);
    
    if (rootMessages.length === 0) {
      // If no root messages, treat the first message as root
      return [{
        id: messages[0].id,
        preview: messages[0].content.length > 50 ? messages[0].content.substring(0, 50) + '...' : messages[0].content,
        messageCount: messages.length
      }];
    }
    
    return rootMessages.map(root => ({
      id: root.id,
      preview: root.content.length > 50 ? root.content.substring(0, 50) + '...' : root.content,
      messageCount: getBranchMessageCount(messages, root.id)
    }));
  }
  
  function getBranchMessageCount(messages: Message[], rootId: string): number {
    const branchMessages = getBranchMessages(messages, rootId);
    return branchMessages.length;
  }

  function selectBranch(branchId: string) {
    selectedBranchId = branchId;
    
    // Force a re-render to show the selected branch messages
    if (activeChat) {
      // This will trigger the reactive statement to update the displayed messages
      activeChat = { ...activeChat };
    }
  }
  


  function getBranchMessages(messages: Message[], branchId: string): Message[] {
    if (!branchId || !messages || messages.length === 0) return messages;
    
    // Find the root message for this branch
    const rootMessage = messages.find(msg => msg.id === branchId);
    if (!rootMessage) return messages;
    
    // Collect all messages in this branch (root + all descendants)
    const branchMessages: Message[] = [];
    const messageMap = new Map(messages.map(msg => [msg.id, msg]));
    
    function collectBranchMessages(messageId: string) {
      const message = messageMap.get(messageId);
      if (message) {
        branchMessages.push(message);
        // Find all children of this message
        messages.forEach(msg => {
          if (msg.parentId === messageId) {
            collectBranchMessages(msg.id);
          }
        });
      }
    }
    
    collectBranchMessages(branchId);
    
    // Sort by timestamp to maintain chronological order
    return branchMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  function getCurrentBranchMessages(): Message[] {
    if (!activeChat) return [];
    
    // If no branch is selected, return all messages (default behavior)
    if (!selectedBranchId) {
      return activeChat.messages;
    }
    
    return getBranchMessages(activeChat.messages, selectedBranchId);
  }

  // Get all available branches for a specific message (including sub-branches)
  function getBranchesForMessage(messageId: string): { id: string; preview: string; messageCount: number }[] {
    if (!activeChat || isStreaming || isUpdatingUI || isGeneratingResponse) return [];
    
    const message = activeChat.messages.find(m => m.id === messageId);
    if (!message) return [];
    
    const branches: { id: string; preview: string; messageCount: number }[] = [];
    
    // If this message has a parent (including NULL), show sibling branches
    if (message.parentId !== undefined) { // Include NULL parent case
      const siblingMessages = activeChat.messages.filter(m => m.parentId === message.parentId);
      
      if (siblingMessages.length > 1) {
        // Add all sibling messages as branches
        siblingMessages.forEach(sibling => {
          branches.push({
            id: sibling.id,
            preview: sibling.content.length > 50 ? sibling.content.substring(0, 50) + '...' : sibling.content,
            messageCount: getBranchMessageCount(activeChat.messages, sibling.id)
          });
        });
        
        // Debug logging (only once per message to prevent spam)
        const logCacheKey = `getBranches_log_${messageId}`;
        if (!branchCheckCache.has(logCacheKey)) {
          console.log(`getBranchesForMessage for "${message.content.substring(0, 30)}...":`, {
            messageId,
            parentId: message.parentId,
            siblingMessages: siblingMessages.length,
            branches: branches.length,
            siblingIds: siblingMessages.map(m => m.id.substring(0, 8)),
            siblingContents: siblingMessages.map(m => m.content.substring(0, 30)),
            totalMessages: activeChat.messages.length
          });
          
          // Cache this log to prevent duplicate logging
          branchCheckCache.set(logCacheKey, { result: true, timestamp: Date.now() });
        }
        
        return branches;
      }
    }
    
    // If this message has multiple children, show child branches
    const childMessages = activeChat.messages.filter(m => m.parentId === messageId);
    if (childMessages.length > 1) {
      // Add the current message as a branch root
      branches.push({
        id: message.id,
        preview: message.content.length > 50 ? message.content.substring(0, 50) + '...' : message.content,
        messageCount: getBranchMessageCount(activeChat.messages, message.id)
      });
      
      // Add all child messages as branches
      childMessages.forEach(child => {
        branches.push({
          id: child.id,
          preview: child.content.length > 50 ? child.content.substring(0, 50) + '...' : child.content,
          messageCount: getBranchMessageCount(activeChat.messages, child.id)
        });
      });
    }
    
    return branches;
  }

  // Flag to prevent branch checking during streaming
  let isStreaming = false;
  
  // Flag to prevent branch checking during UI updates
  let isUpdatingUI = false;
  
  // Flag to completely disable branch checking during response generation
  let isGeneratingResponse = false;
  
  // Debounce mechanism to prevent excessive branch checking
  let lastBranchCheck = 0;
  const BRANCH_CHECK_DEBOUNCE = 100; // 100ms debounce
  
  // Cache for branch check results to prevent redundant calculations
  const branchCheckCache = new Map<string, { result: boolean; timestamp: number }>();
  const CACHE_DURATION = 500; // 500ms cache duration
  
  // Check if a message has multiple branches
  function hasMultipleBranches(messageId: string): boolean {
    if (!activeChat || isStreaming || isUpdatingUI || isGeneratingResponse) return false;
    
    // Debounce: only check once per 100ms
    const now = Date.now();
    if (now - lastBranchCheck < BRANCH_CHECK_DEBOUNCE) {
      return false;
    }
    lastBranchCheck = now;
    
    // Check cache first
    const cached = branchCheckCache.get(messageId);
    if (cached && (now - cached.timestamp) < CACHE_DURATION) {
      return cached.result;
    }
    
    const message = activeChat.messages.find(m => m.id === messageId);
    if (!message) return false;
    
    // Find all messages that have this message as a parent (direct children)
    const childMessages = activeChat.messages.filter(m => m.parentId === messageId);
    
    // Check if this message has siblings (same parent, including NULL parent for root messages)
    let siblingMessages: Message[] = [];
    if (message.parentId !== undefined) { // Include NULL parent case
      siblingMessages = activeChat.messages.filter(m => m.parentId === message.parentId);
    }
    

    
    // Show branches if there are multiple children OR multiple siblings
    // IMPORTANT: siblingMessages.length > 1 means there are at least 2 messages with the same parent
    // This includes the current message + at least 1 other message = 2 total
    const result = childMessages.length > 1 || siblingMessages.length > 1;
    
    // Cache the result
    branchCheckCache.set(messageId, { result, timestamp: now });
    
    return result;
  }
  
  // Get current branch index for a specific message
  function getCurrentBranchIndexForMessage(messageId: string): number {
    if (!activeChat) return 0;
    const branches = getBranchesForMessage(messageId);
    if (branches.length === 0) return 0;
    
    // Find which branch is currently selected for this message
    const currentBranch = branches.find(branch => branch.id === selectedBranchId);
    if (currentBranch) {
      return branches.findIndex(branch => branch.id === selectedBranchId);
    }
    
    // If no branch is selected for this message, default to first
    return 0;
  }
  
  // Navigate to previous branch for a specific message
  function selectPreviousBranchForMessage(messageId: string) {
    const branches = getBranchesForMessage(messageId);
    const currentIndex = getCurrentBranchIndexForMessage(messageId);
    if (currentIndex > 0) {
      const previousBranch = branches[currentIndex - 1];
      selectBranch(previousBranch.id);
    }
  }
  
  // Navigate to next branch for a specific message
  function selectNextBranchForMessage(messageId: string) {
    const branches = getBranchesForMessage(messageId);
    const currentIndex = getCurrentBranchIndexForMessage(messageId);
    if (currentIndex < branches.length - 1) {
      const nextBranch = branches[currentIndex + 1];
      selectBranch(nextBranch.id);
    }
  }

  // Force refresh branch detection for a specific message
  function refreshBranchDetection(messageId: string) {
    if (!activeChat) return;
    
    // Clear cache for this specific message
    branchCheckCache.delete(messageId);
    
    // Force re-evaluation of branches
    const message = activeChat.messages.find(m => m.id === messageId);
    if (message) {
      // Check for siblings
      const siblingMessages = activeChat.messages.filter(m => m.parentId === message.parentId);
      
      if (siblingMessages.length > 1) {
        // Update available branches
        const rootMessages = activeChat.messages.filter(msg => !msg.parentId);
        availableBranches = rootMessages.map(root => ({
          id: root.id,
          preview: root.content.length > 50 ? root.content.substring(0, 50) + '...' : root.content,
          messageCount: getBranchMessageCount(activeChat.messages, root.id)
        }));
        
        // Force re-render
        activeChat = { ...activeChat };
        chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
      }
    }
  }


</script>

<div class="flex bg-white h-full">

  <!-- Chat Sidebar -->
  <div class="w-80 bg-gray-50 border-r border-gray-200 flex flex-col min-h-0">
    <div class="p-4 border-b border-gray-200">
      <div class="flex gap-2">
        <button
          onclick={createNewChat}
          class="flex-1 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm flex items-center justify-center gap-2 cursor-pointer hover:bg-blue-700 transition-colors"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6v6m0 0v6m0-6h6m-6 0H6"></path>
          </svg>
          New Chat
        </button>
                 <button
           onclick={refreshChats}
           class="bg-gray-500 text-white rounded-lg px-3 py-2 text-sm flex items-center justify-center gap-2 cursor-pointer hover:bg-gray-600 transition-colors"
           title="Refresh chats"
           aria-label="Refresh chats"
         >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
          </svg>
        </button>
      </div>
    </div>
    
    <div class="flex-1 overflow-y-auto p-2">
      {#each chats as chat (chat.id)}
        <div
          class={`p-3 rounded-lg mb-2 cursor-pointer group relative w-full ${
            activeChat?.id === chat.id ? 'bg-blue-100 text-blue-900' : 'hover:bg-gray-100'
          }`}
          onclick={() => selectChat(chat)}
          role="button"
          tabindex="0"
          onkeydown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              selectChat(chat);
            }
          }}
        >
          {#if renamingChatId === chat.id}
            <input
              class="text-sm font-medium w-full bg-white border border-blue-300 rounded px-2 py-1"
              bind:value={renameInput}
              onkeydown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); confirmRename(chat); }
                else if (e.key === 'Escape') { renamingChatId = null; }
              }}
              onblur={() => confirmRename(chat)}

            />
          {:else}
            <div class="text-sm font-medium truncate">{chat.title}</div>
          {/if}
          <div class="text-xs text-gray-500 mt-1">{chat.createdAt.toLocaleDateString()}</div>
          <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
            <button
              onclick={(e) => { e.stopPropagation(); startRename(chat); }}
              class="text-gray-500 hover:text-gray-700 text-xs cursor-pointer p-1 hover:bg-gray-200 rounded"
              aria-label="Rename chat"
            >
              ✎
            </button>
            <button
              onclick={(e) => { e.stopPropagation(); deleteChat(chat.id); }}
              class="text-red-500 hover:text-red-700 text-xs cursor-pointer p-1 hover:bg-gray-200 rounded"
              aria-label="Delete chat"
            >
              ✕
            </button>
          </div>
        </div>
      {/each}
    </div>
  </div>

  <!-- Main Chat Area -->
  <div class="flex-1 flex flex-col min-h-0">
         <!-- Header -->
     <header class="border-b border-gray-200 p-4 flex items-center justify-between">
               <div class="flex items-center gap-3">
          <h1 class="text-lg font-semibold text-gray-900">
            {activeChat?.title || 'AI Assistant'}
          </h1>
        </div>
       <div class="text-sm text-gray-500">
         Hello, {data.user.name || 'User'}
       </div>
     </header>

    

         <!-- Messages -->
     <div bind:this={messagesContainer} class="flex-1 overflow-y-auto p-4 space-y-4">
       {#key activeChat?.id}
         {#if !activeChat || activeChat.messages.length === 0}
           <div class="text-center text-gray-500 mt-20">
             <div class="text-4xl mb-4">💬</div>
             <h2 class="text-xl font-semibold mb-2">Start a conversation</h2>
             <p>Ask me anything about your app, or any general question!</p>
           </div>
         {:else}
                       
           
                       {#each (selectedBranchId ? getCurrentBranchMessages() : activeChat.messages) as message, i (`${activeChat.id}-${message.id}`)}
            <div class={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div class="max-w-3xl group">
                <div class="flex items-start gap-2">
                  <button
                    class="mt-1 text-indigo-600 hover:text-indigo-800 cursor-pointer"
                    title="Edit this message"
                    aria-label="Edit this message"
                    onclick={() => startEditMessage(message)}
                  >
                    <svg class="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                      <path d="m18.5 2.5 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                    </svg>
                  </button>
                  <div class={`rounded-2xl px-4 py-3 ${
                    message.role === 'user' 
                      ? 'bg-indigo-600 text-white' 
                      : 'bg-gray-50 text-gray-900 border border-gray-200'
                  }`}>
                    
                     

                    
                                         {#if editingMessageId === message.id}
                       <!-- Inline edit interface -->
                       <div class="space-y-3">
                         <textarea
                           class="w-full resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
                           rows="3"
                           bind:value={editInput}
                           placeholder="Edit your message..."
                           onkeydown={(e) => {
                             if (e.key === 'Enter' && !e.shiftKey) {
                               e.preventDefault();
                               confirmEdit();
                             } else if (e.key === 'Escape') {
                               cancelEdit();
                             }
                           }}
                         ></textarea>
                         <div class="flex gap-2">
                           <button
                             onclick={confirmEdit}
                             class="px-3 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 transition-colors"
                           >
                             Save
                           </button>
                           <button
                             onclick={cancelEdit}
                             class="px-3 py-1 bg-gray-500 text-white text-xs rounded hover:bg-gray-600 transition-colors"
                           >
                             Cancel
                           </button>
                         </div>
                       </div>
                     {:else}
                       <!-- Normal message display -->
                       {#if message.role === 'assistant'}
                         <div class="prose prose-sm max-w-none" use:setHtml={{ html: renderMarkdownLite(message.content) }}></div>
                       {:else}
                         <div class="prose prose-sm max-w-none" use:setHtml={{ html: renderMarkdownLite(message.content) }}></div>
                       {/if}
                     {/if}

                                           <!-- Branch Navigation Arrows - Only for user messages and only on hover -->
                      {#if !editingMessageId && message.role === 'user' && hasMultipleBranches(message.id)}
                        <div class="mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <div class="flex items-center justify-center gap-2">

                            
                            <!-- Previous Branch Button -->
                            {#if getCurrentBranchIndexForMessage(message.id) > 0}
                              <button
                                class="px-2 py-1 text-xs bg-blue-500 text-white hover:bg-blue-600 border border-blue-600 rounded transition-colors"
                                onclick={() => selectPreviousBranchForMessage(message.id)}
                                title="Previous version"
                              >
                                ←
                              </button>
                            {/if}
                            
                            <!-- Current Branch Display -->
                            <span class="px-2 py-1 text-xs bg-gray-600 text-white rounded">
                              {getCurrentBranchIndexForMessage(message.id) + 1} of {getBranchesForMessage(message.id).length}
                            </span>
                            
                            <!-- Next Branch Button -->
                            {#if getCurrentBranchIndexForMessage(message.id) < getBranchesForMessage(message.id).length - 1}
                              <button
                                class="px-2 py-1 text-xs bg-blue-500 text-white hover:bg-blue-600 border border-blue-600 rounded transition-colors"
                                onclick={() => selectNextBranchForMessage(message.id)}
                                title="Next version"
                              >
                                →
                              </button>
                            {/if}
                          </div>
                        </div>

                      {/if}
                  </div>
                </div>
                <div class={`text-xs text-gray-500 mt-1 ${message.role === 'user' ? 'text-right' : 'text-left'}`}>
                  {formatTime(message.timestamp)}
                </div>
              </div>
            </div>
          {/each}
        {/if}
      {/key}
      
      {#if loading}
        <div class="flex justify-start">
          <div class="bg-gray-50 rounded-2xl px-4 py-3 border border-gray-200">
            <div class="flex space-x-1">
              <div class="w-2 h-2 bg-indigo-500 rounded-full animate-bounce"></div>
              <div class="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style="animation-delay: 0.1s"></div>
              <div class="w-2 h-2 bg-indigo-500 rounded-full animate-bounce" style="animation-delay: 0.2s"></div>
            </div>
          </div>
        </div>
      {/if}
    </div>

    {#if error}
      <div class="px-4 py-2 bg-red-50 border-t border-red-200 text-red-700 text-sm">
        {error}
      </div>
    {/if}

    <!-- Debug Panel (only show in development) -->
    {#if browser && import.meta.env.DEV}
      <div class="border-t border-gray-200 p-2 bg-gray-50 text-xs">
        <details>
          <summary class="cursor-pointer font-medium">Debug: Message Structure</summary>
          <div class="mt-2 space-y-1">
            <div>Total Messages: {activeChat?.messages?.length || 0}</div>
            <div>Selected Branch: {selectedBranchId || 'None'}</div>
            <div>Available Branches: {availableBranches.length}</div>
            {#if activeChat?.messages}
              <div class="max-h-32 overflow-y-auto">
                {#each activeChat.messages as msg}
                  <div class="text-gray-600">
                    {msg.role}: {msg.content.substring(0, 30)}... (ID: {msg.id.substring(0, 8)}, Parent: {msg.parentId?.substring(0, 8) || 'null'})
                  </div>
                {/each}
              </div>
            {/if}
          </div>
        </details>
      </div>
    {/if}

    <!-- Input Area -->
    <div class="border-t border-gray-200 p-4">
      
      

      <div class="flex items-end gap-3">
        <div class="flex-1">
          <textarea
            class="w-full resize-none rounded-2xl border border-gray-300 px-4 py-3 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500"
            rows="1"
            placeholder="Type your message..."
            bind:value={input}
            onkeydown={onKeyDown}
            style="min-height: 44px; max-height: 120px;"
          ></textarea>
        </div>
        
                 <div class="flex gap-2">
           <button
             onclick={sendMessage}
             disabled={loading || !input.trim()}
             class="p-3 bg-green-600 text-white rounded-full hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
             aria-label="Send message"
           >
             <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
               <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"></path>
             </svg>
           </button>
           {#if loading}
             <button
               onclick={stopResponse}
               class="p-3 bg-red-600 text-white rounded-full hover:bg-red-700 transition-colors cursor-pointer"
               aria-label="Stop response"
               title="Stop response"
             >
               <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                 <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
               </svg>
             </button>
           {/if}
         </div>
      </div>
      
                           <div class="mt-2 text-xs text-gray-500 text-center">
          Press Enter to send, Shift+Enter for new line
        </div>
    </div>
  </div>
</div>

<style>
  /* Chat-specific styles using basic CSS properties */
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 0.5rem;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.2s;
    outline: none;
    cursor: pointer;
  }

  .btn:disabled {
    opacity: 0.5;
    pointer-events: none;
  }

  .btn-primary {
    background-color: rgb(79 70 229);
    color: white;
    height: 2.5rem;
    padding: 0.5rem 1rem;
  }

  .btn-primary:hover {
    background-color: rgb(67 56 202);
  }

  /* Basic prose styling for markdown elements */
  .prose {
    color: rgb(17 24 39);
  }

  /* Force all code blocks to have dark backgrounds - using direct selectors */
  .prose div[class*="bg-gray-900"],
  .prose div[class*="bg-gray-800"] {
    background-color: rgb(17 24 39) !important;
    color: rgb(229 231 235) !important;
    border: 1px solid rgb(75 85 99) !important;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06) !important;
    padding: 1rem !important;
    border-radius: 0.5rem !important;
    margin: 1rem 0 !important;
  }

  .prose div[class*="bg-gray-900"] code,
  .prose div[class*="bg-gray-800"] code {
    background-color: transparent !important;
    color: rgb(229 231 235) !important;
    border: none !important;
    padding: 0 !important;
  }

  /* Force all inline code to have dark backgrounds */
  .prose code {
    background-color: rgb(31 41 55) !important;
    color: rgb(229 231 235) !important;
    border: 1px solid rgb(75 85 99) !important;
  }

  /* Additional direct targeting for code blocks */
  .prose [class*="language-"] {
    background-color: rgb(17 24 39) !important;
    color: rgb(229 231 235) !important;
  }

  /* Ensure any element with code-related classes has dark background */
  .prose [class*="bg-gray-900"],
  .prose [class*="bg-gray-800"] {
    background-color: rgb(17 24 39) !important;
    color: rgb(229 231 235) !important;
  }

  /* Force user message text to be white */
  .bg-indigo-600 {
    color: white !important;
  }

  .bg-indigo-600 * {
    color: white !important;
  }
</style>
