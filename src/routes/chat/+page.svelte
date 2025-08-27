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
      // Skip empty lines entirely to prevent extra spacing
      if (!line) {
        return '';
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
      
      // CRITICAL FIX: Initialize branches for the first chat
      if (activeChat && activeChat.messages.length > 0) {
        availableBranches = getAvailableBranches(activeChat.messages);
        if (availableBranches.length > 0) {
          // CRITICAL FIX: Select the LAST branch by default (most recent)
          // This ensures UI shows latest content and branch index matches
          selectedBranchId = availableBranches[availableBranches.length - 1].id;
          console.log('Default branch selected:', selectedBranchId);
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
      
      // CRITICAL FIX: Initialize branches for the selected chat
      if (activeChat.messages.length > 0) {
        availableBranches = getAvailableBranches(activeChat.messages);
        if (availableBranches.length > 0) {
          // CRITICAL FIX: Select the LAST branch by default (most recent)
          // This ensures UI shows latest content and branch index matches
          selectedBranchId = availableBranches[availableBranches.length - 1].id;
          console.log('Chat switched, default branch selected:', selectedBranchId);
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
                    // CRITICAL FIX: Refresh branches for the updated chat
                    if (activeChat.messages.length > 0) {
                      availableBranches = getAvailableBranches(activeChat.messages);
                      if (availableBranches.length > 0) {
                        // CRITICAL FIX: Maintain current branch selection if possible
                        if (selectedBranchId && availableBranches.some(b => b.id === selectedBranchId)) {
                          // Keep current selection
                          console.log('Maintaining current branch selection:', selectedBranchId);
                        } else {
                          // Select the LAST branch by default (most recent)
                          selectedBranchId = availableBranches[availableBranches.length - 1].id;
                          console.log('Refreshed, new default branch selected:', selectedBranchId);
                        }
                      }
                    }
                  } else if (chats.length > 0) {
                    activeChat = chats[0];
                    // CRITICAL FIX: Initialize branches for the new active chat
                    if (activeChat.messages.length > 0) {
                      availableBranches = getAvailableBranches(activeChat.messages);
                      if (availableBranches.length > 0) {
                        // CRITICAL FIX: Select the LAST branch by default (most recent)
                        selectedBranchId = availableBranches[availableBranches.length - 1].id;
                        console.log('Chat refreshed, new default branch selected:', selectedBranchId);
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
      // Build branch context for messages - ONLY current branch
      const branchMessages = (() => {
        // Get current branch messages (includes full path from root to current branch)
        const currentBranchMessages = selectedBranchId ? 
          getBranchMessages(activeChat.messages, selectedBranchId) : 
          activeChat.messages;
        
        // Add the new user message to the current branch context
        const messagesWithNewUser = [...currentBranchMessages, userMsg];
        
        return messagesWithNewUser.map(({ role, content }) => ({ role, content, chatId: activeChat.id }));
      })();

      // Validate messages before sending
      const validBranchMessages = branchMessages.filter(msg => 
        msg && 
        typeof msg === 'object' && 
        typeof msg.role === 'string' && 
        ['user', 'assistant', 'system'].includes(msg.role) &&
        typeof msg.content === 'string' && 
        msg.content.trim().length > 0
      );

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
    
    // DON'T change branch selection when starting edit
    // Let the user see the current display without changes
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
      
      // Update available branches using the new branch detection logic
      console.log('=== CALLING getAvailableBranches AFTER EDIT ===');
      availableBranches = getAvailableBranches(activeChat.messages);
      console.log('=== getAvailableBranches RESULT ===', availableBranches);
      
      // Find and select the correct branch that contains the edited message
      console.log('availableBranches:', availableBranches);
      console.log('editedMsg.id:', editedMsg.id);
      
      // CRITICAL FIX: Find branches at the level where the edited message exists
      const editedMsgLevel = editedMsg.parentId || 'root';
      console.log('Looking for branches at level (parentId):', editedMsgLevel);
      
      // Get siblings of the edited message
      const editedMsgSiblings = activeChat.messages.filter(msg => 
        (msg.parentId || 'root') === editedMsgLevel
      );
      
      console.log('Siblings of edited message:', editedMsgSiblings.map(s => s.content));
      
      if (editedMsgSiblings.length > 1) {
        // Use the edited message siblings as the available branches
        availableBranches = editedMsgSiblings.map(sibling => ({
          id: sibling.id,
          preview: sibling.content.length > 50 ? sibling.content.substring(0, 50) + '...' : sibling.content,
          messageCount: getBranchMessageCount(activeChat.messages, sibling.id)
        }));
        
        console.log('Updated availableBranches to edited message level:', availableBranches);
        selectedBranchId = editedMsg.id; // Select the edited message directly
      } else if (availableBranches.length > 0) {
        // Fallback: use the deepest branches if no siblings at edited level
        selectedBranchId = availableBranches[0].id;
      } else {
        selectedBranchId = null;
      }
      
      console.log('final selectedBranchId:', selectedBranchId);
      
      // Force a re-render to show the navigation buttons immediately
      activeChat = { ...activeChat };
      chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
      
      // Force another re-render to ensure proper filtering
      setTimeout(() => {
        if (activeChat) {
          activeChat = { ...activeChat };
          chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
        }
      }, 0);
      
      // Additional re-render after a short delay to ensure proper filtering
      setTimeout(() => {
        if (activeChat) {
          activeChat = { ...activeChat };
          chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
        }
      }, 50);
      
      // Scroll to bottom to show the edited message
      scrollToBottom();
      
      // Note: The edited message now replaces the original in the current branch
      // The AI response will be added below it, creating a new conversation flow

      // Now get the AI response with streaming using proper branch context
      const branchContext = (() => {
        // CRITICAL FIX: Build context from the path up to the edited message (not the selected branch)
        // This ensures AI gets the correct context for the current conversation path
        const pathToEditedMessage = [];
        let currentMsg = editedMsg;
        
        // Build path from edited message back to root
        while (currentMsg) {
          pathToEditedMessage.unshift(currentMsg);
          if (currentMsg.parentId) {
            currentMsg = activeChat.messages.find(m => m.id === currentMsg.parentId);
          } else {
            break;
          }
        }
        
        console.log('=== AI CONTEXT DEBUG ===');
        console.log('Path to edited message:', pathToEditedMessage.map(m => `${m.role}: ${m.content}`));
        
        const context = pathToEditedMessage.map(({ role, content }) => ({ role, content, chatId: activeChat.id }));
        console.log('final context sent to AI:', context);
        
        return context;
      })();
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: branchContext
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

  // Branch management functions - detect branches at any level where siblings exist
  function getAvailableBranches(messages: Message[]): { id: string; preview: string; messageCount: number }[] {
    if (!messages || messages.length === 0) return [];
    
    console.log('=== getAvailableBranches called ===');
    console.log('Input messages length:', messages.length);
    console.log('activeChat.messages length:', activeChat?.messages?.length || 0);
    console.log('Using input messages for branch detection, but activeChat.messages for message counting');
    
    // Find all groups of sibling messages (messages with the same parent)
    const parentGroups = new Map<string | null, Message[]>();
    
    messages.forEach(msg => {
      const parentKey = msg.parentId || 'root';
      if (!parentGroups.has(parentKey)) {
        parentGroups.set(parentKey, []);
      }
      parentGroups.get(parentKey)!.push(msg);
    });
    
    console.log('parentGroups:', Array.from(parentGroups.entries()).map(([parent, children]) => ({
      parent,
      children: children.map(c => c.content)
    })));
    
    // CRITICAL FIX: Don't prioritize deepest branches - maintain all branch levels
    // This prevents parent-level branches from being reset
    const allBranches: { id: string; preview: string; messageCount: number; depth: number }[] = [];
    
    for (const [parentId, siblings] of parentGroups) {
      if (siblings.length > 1) {
        console.log(`Found ${siblings.length} siblings with parent:`, parentId);
        console.log('Siblings:', siblings.map(s => s.content));
        
        // Calculate the depth of this branching point
        let depth = 0;
        if (parentId && parentId !== 'root') {
          // Find the parent message and calculate its depth
          const parentMsg = messages.find(m => m.id === parentId);
          if (parentMsg) {
            depth = getMessageDepth(messages, parentMsg.id);
          }
        }
        
        console.log('Depth for this branching point:', depth);
        
        // Add all branches at this level
        siblings.forEach(sibling => {
          allBranches.push({
            id: sibling.id,
            preview: sibling.content.length > 50 ? sibling.content.substring(0, 50) + '...' : sibling.content,
            // CRITICAL FIX: Always use activeChat.messages for consistent message counting
            messageCount: getBranchMessageCount(activeChat?.messages || [], sibling.id),
            depth: depth
          });
        });
      }
    }
    
    // Sort by depth (shallowest first) to maintain hierarchy
    allBranches.sort((a, b) => a.depth - b.depth);
    
    console.log('All branches found (sorted by depth):', allBranches);
    
    // Return branches without depth info
    const result = allBranches.map(({ id, preview, messageCount }) => ({
      id,
      preview,
      messageCount
    }));
    
    console.log('Returning branches with message counts:', result);
    return result;
  }
  
  // Helper function to calculate message depth in the tree
  function getMessageDepth(messages: Message[], messageId: string): number {
    const messageMap = new Map(messages.map(msg => [msg.id, msg]));
    
    function calculateDepth(id: string): number {
      const msg = messageMap.get(id);
      if (!msg || !msg.parentId) return 0;
      return 1 + calculateDepth(msg.parentId);
    }
    
    return calculateDepth(messageId);
  }
  
  // NEW: Get all branch points in the message tree (for advanced navigation)
  function getAllBranchPoints(messages: Message[]): Map<string | null, Message[]> {
    const parentGroups = new Map<string | null, Message[]>();
    
    messages.forEach(msg => {
      const parentKey = msg.parentId || 'root';
      if (!parentGroups.has(parentKey)) {
        parentGroups.set(parentKey, []);
      }
      parentGroups.get(parentKey)!.push(msg);
    });
    
    // Return only groups that have multiple children (branch points)
    const branchPoints = new Map<string | null, Message[]>();
    for (const [parentId, children] of parentGroups) {
      if (children.length > 1) {
        branchPoints.set(parentId, children);
      }
    }
    
    return branchPoints;
  }
  
  function getBranchMessageCount(messages: Message[], rootId: string): number {
    // CRITICAL FIX: Always use the original message tree from activeChat, not the filtered messages
    // This ensures message counts remain consistent when switching between branches
    if (!activeChat) return 0;
    
    console.log('=== getBranchMessageCount called ===');
    console.log('Input messages length:', messages.length);
    console.log('activeChat.messages length:', activeChat.messages.length);
    console.log('rootId:', rootId);
    
    // Safety check: ensure we're using the correct message array
    if (messages.length !== activeChat.messages.length) {
      console.warn('WARNING: Input messages length differs from activeChat.messages length!');
      console.warn('This could cause inconsistent message counting.');
      console.warn('Input messages:', messages.map(m => ({ id: m.id, content: m.content.substring(0, 30) + '...' })));
      console.warn('ActiveChat messages:', activeChat.messages.map(m => ({ id: m.id, content: m.content.substring(0, 30) + '...' })));
    }
    
    console.log('Using activeChat.messages for consistent counting');
    
    const branchMessages = getBranchMessages(activeChat.messages, rootId);
    const count = branchMessages.length;
    
    console.log('Branch message count result:', count);
    console.log('Branch messages:', branchMessages.map(m => m.content.substring(0, 30) + '...'));
    
    return count;
  }

  function selectBranch(branchId: string) {
    console.log('=== selectBranch called ===');
    console.log('Previous selectedBranchId:', selectedBranchId);
    console.log('New branchId:', branchId);
    console.log('Available branches before switch:', availableBranches);
    
    // CRITICAL FIX: Only change the selected branch, don't affect message indexing
    selectedBranchId = branchId;
    
    // Force a re-render to show the selected branch messages
    if (activeChat) {
      console.log('Active chat messages count:', activeChat.messages.length);
      console.log('Available branches after switch:', availableBranches);
      
      // This will trigger the reactive statement to update the displayed messages
      // but won't affect the branch index calculations for individual messages
      activeChat = { ...activeChat };
    }
  }
  


  function getBranchMessages(messages: Message[], branchId: string): Message[] {
    if (!branchId || !messages || messages.length === 0) return messages;
    
    const selectedMessage = messages.find(msg => msg.id === branchId);
    if (!selectedMessage) return messages;
    
    const messageMap = new Map(messages.map(msg => [msg.id, msg]));
    
    // DEBUG: Add logging to see what's happening
    console.log('getBranchMessages called with branchId:', branchId);
    console.log('selectedMessage:', selectedMessage);
    
    // Collect ONLY the specific path from root to the selected message
    function collectPathToMessage(messageId: string): Message[] {
      const message = messageMap.get(messageId);
      if (!message) return [];
      
      // If this message has a parent, get the path to the parent first
      const pathToParent = message.parentId ? collectPathToMessage(message.parentId) : [];
      
      // Add this message to the path
      return [...pathToParent, message];
    }
    
    // Get the path from root to the selected message
    const pathToSelected = collectPathToMessage(branchId);
    console.log('pathToSelected:', pathToSelected.map(m => m.content));
    
    // Follow ONLY ONE linear path through descendants (not all branches)
    function collectLinearPath(messageId: string, descendants: Message[] = []): Message[] {
      // Find the children of this message
      const children = messages.filter(msg => msg.parentId === messageId);
      
      if (children.length === 0) {
        // No children, end of path
        return descendants;
      }
      
      // If multiple children (branching point), take the first/primary one
      // This ensures we follow only ONE path, not all branches
      const nextMessage = children[0]; // Take first child to follow single path
      descendants.push(nextMessage);
      
      // Continue following this single path
      return collectLinearPath(nextMessage.id, descendants);
    }
    
    const linearDescendants = collectLinearPath(branchId);
    console.log('linear descendants (single path):', linearDescendants.map(m => m.content));
    
    // Combine path and ONLY linear descendants
    const branchMessages = [...pathToSelected, ...linearDescendants];
    
    // Remove duplicates and sort by timestamp
    const uniqueMessages = Array.from(new Map(branchMessages.map(msg => [msg.id, msg])).values());
    const sortedMessages = uniqueMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
    
    console.log('final branch messages (path + all descendants):', sortedMessages.map(m => m.content));
    
    return sortedMessages;
  }

  // Helper function to get messages for current branch with safety checks
  function getCurrentBranchMessages(): Message[] {
    if (!activeChat) return [];
    if (!selectedBranchId) return activeChat.messages;
    
    // CRITICAL FIX: Check if selectedBranchId is the root message (has no parent)
    const selectedMessage = activeChat.messages.find(msg => msg.id === selectedBranchId);
    if (selectedMessage && !selectedMessage.parentId) {
      // Root message selected, return all messages
      console.log('Root message selected, returning all messages');
      return activeChat.messages;
    }
    
    // CRITICAL FIX: Get messages for the selected branch
    console.log('Getting messages for selected branch:', selectedBranchId);
    return getBranchMessages(activeChat.messages, selectedBranchId);
  }

  // Get all available branches for a specific message (enhanced for multi-level trees)
  function getBranchesForMessage(messageId: string): { id: string; preview: string; messageCount: number }[] {
    if (!activeChat || isStreaming || isUpdatingUI || isGeneratingResponse) return [];
    
    const message = activeChat.messages.find(m => m.id === messageId);
    if (!message) return [];
    
    // Get all branch points in the tree
    const branchPoints = getAllBranchPoints(activeChat.messages);
    
    // Check if this message has siblings (same parent)
    const parentKey = message.parentId || 'root';
    const siblingMessages = branchPoints.get(parentKey) || [];
    
    if (siblingMessages.length > 1) {
      // CRITICAL FIX: Return sibling messages as branches in chronological order
      // This ensures proper branch navigation and consistent indexing
      const sortedSiblings = siblingMessages.sort((a, b) => 
        a.timestamp.getTime() - b.timestamp.getTime()
      );
      
      console.log('Found branches for message:', messageId, 'siblings:', sortedSiblings.map(s => s.content));
      console.log('Branch order (by timestamp):', sortedSiblings.map(s => new Date(s.timestamp).toLocaleTimeString()));
      
      return sortedSiblings.map(sibling => ({
        id: sibling.id,
        preview: sibling.content.length > 50 ? sibling.content.substring(0, 50) + '...' : sibling.content,
        messageCount: getBranchMessageCount(activeChat.messages, sibling.id)
      }));
    }
    
    return [];
  }

  // Flag to prevent branch checking during streaming
  let isStreaming = false;
  
  // Flag to prevent branch checking during UI updates
  let isUpdatingUI = false;
  
  // Flag to completely disable branch checking during response generation
  let isGeneratingResponse = false;
  
  // Flag to prevent branch checking during regeneration
  let isRegeneratingResponse = false;
  
  // Debounce mechanism to prevent excessive branch checking
  let lastBranchCheck = 0;
  const BRANCH_CHECK_DEBOUNCE = 100; // 100ms debounce
  
  // Cache for branch check results to prevent redundant calculations
  const branchCheckCache = new Map<string, { result: boolean; timestamp: number }>();
  const CACHE_DURATION = 500; // 500ms cache duration
  
  // Check if a message has multiple branches (enhanced for multi-level trees)
  function hasMultipleBranches(messageId: string): boolean {
    if (!activeChat || isStreaming || isUpdatingUI || isGeneratingResponse) return false;
    
    const message = activeChat.messages.find(m => m.id === messageId);
    if (!message) return false;
    
    // Get all branch points in the tree
    const branchPoints = getAllBranchPoints(activeChat.messages);
    
    // Check if this message has siblings (same parent)
    let siblingMessages: Message[] = [];
    if (message.parentId !== undefined) { // Include NULL parent case
      const parentKey = message.parentId || 'root';
      siblingMessages = branchPoints.get(parentKey) || [];
    }
    
    // Show branches if there are multiple siblings
    const result = siblingMessages.length > 1;
    
    return result;
  }
  
  // Get current branch index for a specific message
  function getCurrentBranchIndexForMessage(messageId: string): number {
    if (!activeChat) return 0;
    
    // CRITICAL FIX: Get branches for THIS specific message, not the selected branch
    const branches = getBranchesForMessage(messageId);
    if (branches.length === 0) return 0;
    
    // Find which branch this specific message belongs to
    const message = activeChat.messages.find(m => m.id === messageId);
    if (!message) return 0;
    
    // Find the index of this message within its sibling group
    const parentKey = message.parentId || 'root';
    const siblingMessages = activeChat.messages.filter(m => 
      (m.parentId || 'root') === parentKey
    );
    
    if (siblingMessages.length > 1) {
      // Sort siblings by timestamp to maintain consistent order
      const sortedSiblings = siblingMessages.sort((a, b) => 
        a.timestamp.getTime() - b.timestamp.getTime()
      );
      
      // Find the index of this message in its sibling group
      const messageIndex = sortedSiblings.findIndex(m => m.id === messageId);
      console.log(`Message "${message.content.substring(0, 30)}..." is at index ${messageIndex} of ${sortedSiblings.length} siblings`);
      return messageIndex;
    }
    
    return 0;
  }
  
  // Navigate to previous branch for a specific message
  function selectPreviousBranchForMessage(messageId: string) {
    const branches = getBranchesForMessage(messageId);
    const currentIndex = getCurrentBranchIndexForMessage(messageId);
    
    console.log('=== selectPreviousBranchForMessage ===');
    console.log('Message ID:', messageId);
    console.log('Available branches:', branches.map(b => b.preview));
    console.log('Current index:', currentIndex);
    
    if (currentIndex > 0) {
      const previousBranch = branches[currentIndex - 1];
      console.log('Navigating to previous branch:', previousBranch.id, previousBranch.preview);
      selectBranch(previousBranch.id);
    } else {
      console.log('Already at first branch, cannot go previous');
    }
  }
  
  // Navigate to next branch for a specific message
  function selectNextBranchForMessage(messageId: string) {
    const branches = getBranchesForMessage(messageId);
    const currentIndex = getCurrentBranchIndexForMessage(messageId);
    
    console.log('=== selectNextBranchForMessage ===');
    console.log('Message ID:', messageId);
    console.log('Available branches:', branches.map(b => b.preview));
    console.log('Current index:', currentIndex);
    
    if (currentIndex < branches.length - 1) {
      const nextBranch = branches[currentIndex + 1];
      console.log('Navigating to next branch:', nextBranch.id, nextBranch.preview);
      selectBranch(nextBranch.id);
    } else {
      console.log('Already at last branch, cannot go next');
    }
  }

  // Global branch navigation functions for keyboard shortcuts
  function selectPreviousBranch() {
    if (!activeChat || !selectedBranchId) return;
    
    // Find the current branch in availableBranches
    const currentIndex = availableBranches.findIndex(b => b.id === selectedBranchId);
    if (currentIndex > 0) {
      const previousBranch = availableBranches[currentIndex - 1];
      console.log('Keyboard shortcut: navigating to previous branch:', previousBranch.id, previousBranch.preview);
      selectBranch(previousBranch.id);
    } else {
      console.log('Already at first branch, cannot go previous');
    }
  }
  
  function selectNextBranch() {
    if (!activeChat || !selectedBranchId) return;
    
    // Find the current branch in availableBranches
    const currentIndex = availableBranches.findIndex(b => b.id === selectedBranchId);
    if (currentIndex < availableBranches.length - 1) {
      const nextBranch = availableBranches[currentIndex + 1];
      console.log('Keyboard shortcut: navigating to next branch:', nextBranch.id, nextBranch.preview);
      selectBranch(nextBranch.id);
    } else {
      console.log('Already at last branch, cannot go next');
    }
  }

  // Regenerate AI response - creates a new branch
  async function regenerateResponse(assistantMessage: Message) {
    if (!activeChat || isRegeneratingResponse) return;
    
    console.log('=== Regenerating AI response ===');
    console.log('Assistant message to regenerate:', assistantMessage.content.substring(0, 50) + '...');
    
    // Set regeneration flag to prevent multiple calls
    isRegeneratingResponse = true;
    
    try {
      // Find the parent user message of this AI response
      const parentUserMessage = activeChat.messages.find(m => m.id === assistantMessage.parentId);
      if (!parentUserMessage) {
        console.error('No parent user message found for regeneration');
        return;
      }
      
      // Create a new AI response as a SIBLING (same parent as original)
      const newAssistantId = crypto.randomUUID();
      const newAssistantMsg: Message = {
        id: newAssistantId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        parentId: parentUserMessage.id // Same parent - this makes them siblings!
      };
      
      // Add the new assistant message to the chat
      activeChat.messages = [...activeChat.messages, newAssistantMsg];
      chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
      
      // Clear branch check cache to ensure fresh results after regeneration
      branchCheckCache.clear();
      
      // Update available branches using the new branch detection logic
      console.log('=== CALLING getAvailableBranches AFTER REGENERATION ===');
      availableBranches = getAvailableBranches(activeChat.messages);
      console.log('=== getAvailableBranches RESULT ===', availableBranches);
      
      // Find branches at the level where the regenerated message exists
      const regeneratedMsgLevel = newAssistantMsg.parentId || 'root';
      console.log('Looking for branches at level (parentId):', regeneratedMsgLevel);
      
      // Get siblings of the regenerated message (all AI responses to the same user message)
      const regeneratedMsgSiblings = activeChat.messages.filter(msg => 
        msg.parentId === regeneratedMsgLevel && msg.role === 'assistant'
      );
      
      console.log('AI response siblings:', regeneratedMsgSiblings.map(s => s.content.substring(0, 30) + '...'));
      
      if (regeneratedMsgSiblings.length > 1) {
        // Use the AI response siblings as the available branches
        availableBranches = regeneratedMsgSiblings.map(sibling => ({
          id: sibling.id,
          preview: sibling.content.length > 50 ? sibling.content.substring(0, 50) + '...' : sibling.content,
          messageCount: getBranchMessageCount(activeChat.messages, sibling.id)
        }));
        
        console.log('Updated availableBranches to AI response level:', availableBranches);
        selectedBranchId = newAssistantMsg.id; // Select the new response directly
      } else if (availableBranches.length > 0) {
        // Fallback: use the deepest branches if no siblings at regenerated level
        selectedBranchId = availableBranches[0].id;
      } else {
        selectedBranchId = null;
      }
      
      console.log('final selectedBranchId:', selectedBranchId);
      
      // Force a re-render to show the navigation buttons immediately
      activeChat = { ...activeChat };
      chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
      
      // Now get the AI response with streaming using proper branch context
      const branchContext = (() => {
        // Build context from the path up to the user message that triggered this AI response
        const pathToUserMessage = [];
        let currentMsg = parentUserMessage;
        
        // Build path from user message back to root
        while (currentMsg) {
          pathToUserMessage.unshift(currentMsg);
          if (currentMsg.parentId) {
            currentMsg = activeChat.messages.find(m => m.id === currentMsg.parentId);
          } else {
            break;
          }
        }
        
        console.log('=== AI REGENERATION CONTEXT DEBUG ===');
        console.log('Path to user message:', pathToUserMessage.map(m => `${m.role}: ${m.content}`));
        
        const context = pathToUserMessage.map(({ role, content }) => ({ role, content, chatId: activeChat.id }));
        console.log('final context sent to AI for regeneration:', context);
        
        return context;
      })();
      
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: branchContext
        })
      });

      if (!response.ok) {
        throw new Error('Failed to get AI response');
      }

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
                  msg.id === newAssistantId ? { ...msg, content: assistantText } : msg
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

      // Save the regenerated message to DB
      try {
        await fetch('/api/chat/message', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            id: newAssistantId,
            chatId: activeChat.id,
            parentId: parentUserMessage.id, // Child of user message
            role: 'assistant',
            content: assistantText
          })
        });
        
        // Response generation complete, reset all flags
        isStreaming = false;
        isGeneratingResponse = false;
        isUpdatingUI = false;
        
        // Force a re-render to ensure the navigation buttons appear
        activeChat = { ...activeChat };
        chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);
        
      } catch (e) {
        console.error('Failed to save regenerated message:', e);
      }
      
    } catch (e) {
      console.error('Error regenerating response:', e);
    } finally {
      // Always reset the regeneration flag
      isRegeneratingResponse = false;
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
        // CRITICAL FIX: Update available branches without resetting selection
        const rootMessages = activeChat.messages.filter(msg => !msg.parentId);
        availableBranches = rootMessages.map(root => ({
          id: root.id,
          preview: root.content.length > 50 ? root.content.substring(0, 50) + '...' : root.content,
          // CRITICAL FIX: Always use activeChat.messages for consistent message counting
          messageCount: getBranchMessageCount(activeChat.messages, root.id)
        }));
        
        // CRITICAL FIX: Maintain current branch selection if possible
        if (selectedBranchId && availableBranches.some(b => b.id === selectedBranchId)) {
          console.log('Maintaining current branch selection after refresh:', selectedBranchId);
        } else if (availableBranches.length > 0) {
          // Select the LAST branch by default (most recent)
          selectedBranchId = availableBranches[availableBranches.length - 1].id;
          console.log('Refresh completed, new default branch selected:', selectedBranchId);
        }
        
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
                       
           
                       {#each (selectedBranchId ? getBranchMessages(activeChat.messages, selectedBranchId) : activeChat.messages) as message, i (`${activeChat.id}-${message.id}`)}
            <div class={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div class="max-w-3xl group">
                <div class="flex items-start gap-2">
                  {#if message.role === 'user'}
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
                  {/if}
                  {#if message.role === 'assistant'}
                    <button
                      class="mt-1 text-green-600 hover:text-green-800 cursor-pointer"
                      title="Regenerate response"
                      aria-label="Regenerate response"
                      onclick={() => regenerateResponse(message)}
                      disabled={isRegeneratingResponse}
                    >
                      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/>
                      </svg>
                    </button>
                  {/if}
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

                      <!-- Branch Navigation Arrows for AI responses - Only on hover -->
                      {#if !editingMessageId && message.role === 'assistant' && hasMultipleBranches(message.id)}
                        <div class="mt-2 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                          <div class="flex items-center justify-center gap-2">

                            
                            <!-- Previous Branch Button -->
                            {#if getCurrentBranchIndexForMessage(message.id) > 0}
                              <button
                                class="px-2 py-1 text-xs bg-green-500 text-white hover:bg-green-600 border border-green-600 rounded transition-colors"
                                onclick={() => selectPreviousBranchForMessage(message.id)}
                                title="Previous response"
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
                                class="px-2 py-1 text-xs bg-green-500 text-white hover:bg-green-600 border border-green-600 rounded transition-colors"
                                onclick={() => selectNextBranchForMessage(message.id)}
                                title="Next response"
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
