<script lang="ts">
  import { onMount, afterUpdate } from 'svelte';
  import { browser } from '$app/environment';

  export let data: {
    user: { id: string; name?: string | null; email?: string | null; role?: string | null };
    chats: any[];
    messages: any[];
  };

  type Message = { 
    id: string; 
    role: 'user' | 'assistant'; 
    content: string; 
    timestamp: Date; 
    citations?: Array<{ id: number; source_doc: string; chunk_id: string; snippet: string; }>;
  };
  type Chat = { id: string; title: string; messages: Message[]; createdAt: Date };

  let chats: Chat[] = [];
  let activeChat: Chat | null = null;
  let input = '';
  let loading = false;
  let error: string | null = null;
  let abortController: AbortController | null = null;

  let renamingChatId: string | null = null;
  let renameInput = '';
  let fileInput: HTMLInputElement;
  let uploadedFile: File | null = null;
  let isUploading = false;
  let uploadProgress = '';
  let attachedFiles: Array<{file: File, documentId?: string, chunksCount?: number}> = [];

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

  function escapeHtml(s: string): string {
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function renderMarkdownLite(src: string, citations?: Array<{ id: number; source_doc: string; chunk_id: string; snippet: string; }>): string {
    let text = src || '';
    
    // Headers (# ## ###)
    text = text.replace(/^### (.*$)/gim, '<h3 class="text-lg font-semibold mt-4 mb-2">$1</h3>');
    text = text.replace(/^## (.*$)/gim, '<h2 class="text-xl font-semibold mt-4 mb-2">$1</h2>');
    text = text.replace(/^# (.*$)/gim, '<h1 class="text-2xl font-bold mt-4 mb-2">$1</h1>');
    
    // Code fences ```lang\ncode\n``` with syntax highlighting
    text = text.replace(/```([a-zA-Z0-9+-]*)\n([\s\S]*?)```/g, (_m, lang, code) => {
      const cls = lang ? ` class="language-${lang}"` : '';
      const langLabel = lang ? `<div class="text-xs text-gray-300 mb-2 font-mono bg-gray-700 px-2 py-1 rounded">${lang}</div>` : '';
      return `<div class="bg-gray-900 text-gray-100 rounded-lg p-4 my-4 overflow-x-auto border border-gray-600 shadow-lg" style="background-color: rgb(17 24 39) !important; color: rgb(229 231 235) !important;"><pre class="bg-gray-900 text-gray-100" style="background-color: rgb(17 24 39) !important; color: rgb(229 231 235) !important;"><code${cls}>${langLabel}${escapeHtml(code.trim())}</code></pre></div>`;
    });
    
    // Inline code `code`
    text = text.replace(/`([^`]+)`/g, (_m, code) => `<code class="bg-gray-800 text-gray-100 px-2 py-1 rounded text-sm font-mono border border-gray-600" style="background-color: rgb(31 41 55) !important; color: rgb(229 231 235) !important;">${escapeHtml(code)}</code>`);
    
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
    
      // Inline citations with tooltips <sup data-cite='1'>[1]</sup>
    if (citations && citations.length > 0) {
      console.log('🔍 Processing citations in frontend:', citations);
      console.log('🔍 Original text:', text.substring(0, 200) + '...');
      
      // First, clean up any malformed or nested sup tags and convert to plain text
      text = text.replace(/<sup[^>]*>\[(\d+)\]<\/sup>/g, '[$1]');
      
      // CRITICAL: Remove any ">" prefixes that might be showing
      text = text.replace(/>\[(\d+(?:,\s*\d+)*)\]/g, '[$1]');
      text = text.replace(/>\[(\d+)\]/g, '[$1]');
      
      // Ensure consistent line breaks for better formatting
      text = text.replace(/\n\n+/g, '\n\n'); // Normalize multiple line breaks
      text = text.replace(/\n\s*\n/g, '\n\n'); // Clean up line breaks with spaces
      
      // CRITICAL: Remove any raw data attributes that might still be showing
      text = text.replace(/data-citation-id="[^"]*"/g, '');
      text = text.replace(/data-source-doc="[^"]*"/g, '');
      text = text.replace(/data-chunk-id="[^"]*"/g, '');
      text = text.replace(/data-snippet="[^"]*"/g, '');
      text = text.replace(/data-citation-id='[^']*'/g, '');
      text = text.replace(/data-source-doc='[^']*'/g, '');
      text = text.replace(/data-chunk-id='[^']*'/g, '');
      text = text.replace(/data-snippet='[^']*'/g, '');
      
      // AGGRESSIVE CLEANUP: Remove any remaining raw data attributes with any format
      text = text.replace(/data-[^=]*="[^"]*"/g, '');
      text = text.replace(/data-[^=]*='[^']*'/g, '');
      text = text.replace(/data-[^=]*=[^"'\s>]+/g, '');
      
      // Remove any raw data attributes that might be showing as plain text
      text = text.replace(/data-citation-id="[^"]*"/g, '');
      text = text.replace(/data-source-doc="[^"]*"/g, '');
      text = text.replace(/data-chunk-id="[^"]*"/g, '');
      text = text.replace(/data-snippet="[^"]*"/g, '');
      text = text.replace(/data-citation-id='[^']*'/g, '');
      text = text.replace(/data-source-doc='[^']*'/g, '');
      text = text.replace(/data-chunk-id='[^']*'/g, '');
      text = text.replace(/data-snippet='[^']*'/g, '');
      
      // COMPREHENSIVE CLEANUP: Handle the specific pattern from your example
      // Remove patterns like: data-citation-id="5" data-source-doc="Israel_info.txt" etc.
      text = text.replace(/data-citation-id="[^"]*"\s*/g, '');
      text = text.replace(/data-source-doc="[^"]*"\s*/g, '');
      text = text.replace(/data-chunk-id="[^"]*"\s*/g, '');
      text = text.replace(/data-snippet="[^"]*"\s*/g, '');
      text = text.replace(/data-citation-id='[^']*'\s*/g, '');
      text = text.replace(/data-source-doc='[^']*'\s*/g, '');
      text = text.replace(/data-chunk-id='[^']*'\s*/g, '');
      text = text.replace(/data-snippet='[^']*'\s*/g, '');
      
      // Remove any remaining data attributes with any format
      text = text.replace(/data-[^=]*="[^"]*"\s*/g, '');
      text = text.replace(/data-[^=]*='[^']*'\s*/g, '');
      text = text.replace(/data-[^=]*=[^"'\s>]+\s*/g, '');
      
      // Deduplicate citations by document and chunk to avoid multiple tooltips for same source
      const uniqueCitations = citations.reduce((acc, citation) => {
        const key = `${citation.source_doc}-${citation.chunk_id}`;
        if (!acc.has(key)) {
          acc.set(key, citation);
        }
        return acc;
      }, new Map());
      
      // Process plain text citations like [1], [2], [1, 2, 3] and convert to interactive superscripts
      text = text.replace(/\[(\d+(?:,\s*\d+)*)\]/g, (match, numbers) => {
        console.log('🔍 Found citation pattern:', match, '->', numbers);
        const citationIds = numbers.split(',').map((n: string) => n.trim());
        
        const result = citationIds.map((id: string) => {
          const citation = citations.find(c => c.id === parseInt(id));
          if (citation) {
            console.log('🔍 Found citation data for ID', id, ':', citation);
            // Escape HTML in data attributes to prevent XSS
            const escapedSourceDoc = escapeHtml(citation.source_doc);
            const escapedChunkId = escapeHtml(citation.chunk_id);
            const escapedSnippet = escapeHtml(citation.snippet);
            
            return `<sup class="citation-sup cursor-pointer text-blue-600 hover:text-blue-800 font-semibold transition-colors duration-200" 
                     data-citation-id="${citation.id}"
                     data-source-doc="${escapedSourceDoc}"
                     data-chunk-id="${escapedChunkId}"
                     data-snippet="${escapedSnippet}">[${citation.id}]</sup>`;
          }
          console.log('🔍 No citation found for ID:', id);
          return `[${id}]`;
        }).join('');
        
        console.log('🔍 Generated citation HTML:', result);
        return result;
      });
      
      // FINAL CLEANUP: Remove any remaining raw data attributes that might be showing as text
      text = text.replace(/data-[^=]*="[^"]*"/g, '');
      text = text.replace(/data-[^=]*='[^']*'/g, '');
      text = text.replace(/data-[^=]*=[^"'\s>]+/g, '');
      
      // FINAL CLEANUP: Remove any remaining ">" prefixes
      text = text.replace(/>\[(\d+(?:,\s*\d+)*)\]/g, '[$1]');
      text = text.replace(/>\[(\d+)\]/g, '[$1]');
      
      // FINAL FORMATTING: Ensure consistent spacing and formatting
      text = text.replace(/\n{3,}/g, '\n\n'); // Max 2 consecutive line breaks
      text = text.replace(/\s+$/gm, ''); // Remove trailing spaces on lines
      text = text.replace(/^\s+/gm, ''); // Remove leading spaces on lines (except in code blocks)
      
      console.log('🔍 Final processed text:', text.substring(0, 200) + '...');
    }
    
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
      const cells = content.split('|').map((cell: string) => `<td class="border border-gray-300 px-3 py-2">${cell.trim()}</td>`).join('');
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
          content: msg.content ? msg.content.trim() : '',
          timestamp: new Date(msg.createdAt)
        })) : []
      }));
      
      // Set the first chat as active
      activeChat = chats[0];
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
                content: msg.content ? msg.content.trim() : '',
                timestamp: new Date(msg.createdAt)
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
                    timestamp: new Date(msg.createdAt)
                  })) : []
                }));
                
                // Update active chat if it still exists
                if (activeChat) {
                  const updatedActiveChat = chats.find(c => c.id === activeChat.id);
                  if (updatedActiveChat) {
                    activeChat = updatedActiveChat;
                  } else if (chats.length > 0) {
                    activeChat = chats[0];
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
    if ((!text && attachedFiles.length === 0) || loading || !activeChat) return;
    
    console.log('Sending message with text:', text);
    console.log('Active chat messages count:', activeChat.messages.length);
    console.log('Attached files:', attachedFiles.length);
    
    // Process attached files first if any
    if (attachedFiles.length > 0) {
      isUploading = true;
      uploadProgress = 'Processing attached files...';
      
      try {
        for (let i = 0; i < attachedFiles.length; i++) {
          const attachedFile = attachedFiles[i];
          if (attachedFile.documentId) continue; // Already processed
          
          uploadProgress = `Processing ${attachedFile.file.name}...`;
          
          // Show OCR processing message for PDFs
          if (attachedFile.file.type === 'application/pdf') {
            uploadProgress = `Processing ${attachedFile.file.name} (may take longer for scanned documents)...`;
          }
          
          // Handle file upload based on type
          let response;
          
          if (attachedFile.file.type === 'application/pdf') {
            // For PDF files, use multipart/form-data upload
            const formData = new FormData();
            formData.append('file', attachedFile.file);
            
            response = await fetch('/api/ingest', {
              method: 'POST',
              body: formData,
            });
          } else {
            // For text files, read content and send as JSON
            const content = await attachedFile.file.text();
            
            const documentData = {
              title: attachedFile.file.name,
              content: content,
              source: `Uploaded: ${attachedFile.file.name}`,
              mimeType: attachedFile.file.type || 'text/plain'
            };
            
            response = await fetch('/api/ingest', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify(documentData),
            });
          }
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Failed to process ${attachedFile.file.name}: ${errorData.error || 'Unknown error'}`);
          }
          
          const result = await response.json();
          
          // Update the attached file with document info
          attachedFiles[i] = {
            ...attachedFile,
            documentId: result.documentId,
            chunksCount: result.chunksCount
          };
          
          // Log success to terminal (not chat)
          console.log(`✅ Document uploaded successfully: ${attachedFile.file.name} (${result.chunksCount} chunks)`);
        }
      } catch (err: any) {
        error = err?.message || 'Failed to process attached files';
        console.error('File processing error:', err);
        isUploading = false;
        return;
      } finally {
        isUploading = false;
        uploadProgress = '';
      }
    }
    
    input = '';
    error = null;

    // Create user message content - keep it clean for the user
    let userContent = text;
    if (attachedFiles.length > 0) {
      const fileInfo = attachedFiles.map(af => `📄 ${af.file.name}`).join('\n');
      userContent = text ? `${text}\n\n**Attached Files:**\n${fileInfo}` : `**Attached Files:**\n${fileInfo}`;
    }

    // Create internal prompt for AI (not shown to user)
    let internalPrompt = userContent;
    
    // Only create document summary prompt if there's no text AND files are attached
    // This prevents treating "upload + question" as a summary request
    if (!text && attachedFiles.length > 0) {
      internalPrompt = `Please provide a comprehensive summary of the attached document(s) and suggest what questions I can ask about the content. Include:

1. **Document Summary**: A structured overview of the main content
2. **Key Topics**: Main themes and subjects covered
3. **Suggested Questions**: 5-7 specific questions I can ask about this document

**Attached Files:**
${attachedFiles.map(af => `📄 ${af.file.name}`).join('\n')}`;
    } else if (text && attachedFiles.length > 0) {
      // User provided both text (question) and files - treat as a question about the documents
      internalPrompt = `${text}

**Attached Files:**
${attachedFiles.map(af => `📄 ${af.file.name}`).join('\n')}

Please answer my question based on the content of the attached documents.`;
    }

    const userMsg: Message = { 
      id: crypto.randomUUID(), 
      role: 'user', 
      content: userContent,
      timestamp: new Date()
    };

    console.log('Created userMsg:', userMsg);

    // Update chat title if it's the first message
    if (activeChat.messages.length === 0) {
      activeChat.title = text.length > 50 ? text.substring(0, 50) + '...' : text;
    }



    loading = true;
    scrollToBottom();
    
    // Create new AbortController for this request
    abortController = new AbortController();

    try {
      // Build messages for conversation
      const branchMessages = (() => {
        // Normal linear conversation - send all messages plus the new user message with internal prompt
        const allMessages = [...activeChat.messages];
        const userMsgWithInternalPrompt = { ...userMsg, content: internalPrompt };
        allMessages.push(userMsgWithInternalPrompt);
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
      activeChat.messages = [...activeChat.messages, userMsg];
      chats = chats.map(c => c.id === activeChat?.id ? activeChat : c);

             const res = await fetch('/api/chat/rag', {
         method: 'POST',
         body: JSON.stringify({ messages: validBranchMessages }),
         headers: { 'content-type': 'application/json' },
         signal: abortController.signal
       });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to get response');
      }

      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let citations: Array<{ id: number; source_doc: string; chunk_id: string; snippet: string; }> = [];
      
      // Add placeholder message for streaming
      const assistantId = crypto.randomUUID();
      const assistantMsg: Message = { 
        id: assistantId, 
        role: 'assistant', 
        content: '',
        timestamp: new Date()
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
            // Handle text chunks (type 0)
            const textMatch = line.match(/^0:(.*)$/);
            if (textMatch) {
              try {
                const decoded = JSON.parse(textMatch[1]);
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
            
            // Handle completion data with citations (type 1)
            const completeMatch = line.match(/^1:(.*)$/);
            if (completeMatch) {
              try {
                const data = JSON.parse(completeMatch[1]);
                if (data.type === 'complete' && data.citations) {
                  citations = data.citations;
                  // Store citations in the message for tooltip rendering
                  activeChat.messages = activeChat.messages.map((msg) =>
                    msg.id === assistantId ? { ...msg, content: assistantText, citations: citations } : msg
                  );
                  chats = chats.map((c) => (c.id === activeChat?.id ? activeChat : c));
                  
                  // Setup tooltips after citations are added with multiple attempts
                  setTimeout(() => {
                    setupCitationTooltips();
                  }, 100);
                  
                  // Additional setup attempts to ensure tooltips work
                  setTimeout(() => {
                    setupCitationTooltips();
                  }, 300);
                  
                  setTimeout(() => {
                    setupCitationTooltips();
                  }, 500);
                }
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
            role: 'assistant',
            content: assistantText
          })
        });
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
      // Clear attached files after sending message
      attachedFiles = [];
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
    
    // Setup citation tooltips
    setupCitationTooltips();
  });
  
  // Setup citation tooltips
  function setupCitationTooltips() {
    if (typeof window === 'undefined') return;
    
    // Remove existing tooltips
    const existingTooltips = document.querySelectorAll('.citation-tooltip');
    existingTooltips.forEach(tooltip => tooltip.remove());
    
    // Add event listeners to citation elements
    const citationElements = document.querySelectorAll('.citation-sup');
    console.log('🔍 Found citation elements:', citationElements.length);
    
    if (citationElements.length === 0) {
      console.log('🔍 No citation elements found, trying again in 100ms...');
      setTimeout(() => setupCitationTooltips(), 100);
      return;
    }
    
    citationElements.forEach((element, index) => {
      console.log(`🔍 Setting up tooltip for citation ${index + 1}:`, element);
      
      // Remove existing event listeners to prevent duplicates
      element.removeEventListener('mouseenter', showCitationTooltip);
      element.removeEventListener('mouseleave', hideCitationTooltip);
      
      // Add new event listeners
      element.addEventListener('mouseenter', showCitationTooltip);
      element.addEventListener('mouseleave', hideCitationTooltip);
    });
  }
  
  function showCitationTooltip(event: Event) {
    const element = event.target as HTMLElement;
    const citationId = element.getAttribute('data-citation-id');
    const sourceDoc = element.getAttribute('data-source-doc');
    const chunkId = element.getAttribute('data-chunk-id');
    const snippet = element.getAttribute('data-snippet');
    
    if (!citationId || !sourceDoc || !chunkId || !snippet) {
      console.warn('Missing citation data for tooltip');
      return;
    }
    
    // Remove existing tooltips
    const existingTooltips = document.querySelectorAll('.citation-tooltip');
    existingTooltips.forEach(tooltip => tooltip.remove());
    
    // Create tooltip with improved styling and content truncation
    const tooltip = document.createElement('div');
    tooltip.className = 'citation-tooltip fixed z-50 bg-white border border-gray-300 rounded-xl shadow-lg p-3 max-w-md';
    
    // Truncate snippet to 1-2 lines (approximately 150 characters)
    const truncatedSnippet = snippet.length > 150 ? snippet.substring(0, 150) + '...' : snippet;
    
    tooltip.innerHTML = `
      <div class="text-sm font-semibold text-gray-900 mb-1">${sourceDoc}</div>
      <div class="text-xs text-gray-500 mb-2 font-mono">${chunkId}</div>
      <div class="text-sm text-gray-700 leading-relaxed">${truncatedSnippet}</div>
    `;
    
    document.body.appendChild(tooltip);
    
    // Position tooltip with improved logic
    const rect = element.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    
    // Calculate initial position (centered above the citation)
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    let top = rect.top - tooltipRect.height - 8;
    
    // Adjust if tooltip goes off screen horizontally
    if (left < 12) left = 12;
    if (left + tooltipRect.width > window.innerWidth - 12) {
      left = window.innerWidth - tooltipRect.width - 12;
    }
    
    // Adjust if tooltip goes off screen vertically (show below instead)
    if (top < 12) {
      top = rect.bottom + 8;
    }
    
    // Ensure tooltip stays within viewport
    if (top + tooltipRect.height > window.innerHeight - 12) {
      top = window.innerHeight - tooltipRect.height - 12;
    }
    
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }
  
  function hideCitationTooltip() {
    const tooltips = document.querySelectorAll('.citation-tooltip');
    tooltips.forEach(tooltip => {
      // Add fade-out animation before removing
      (tooltip as HTMLElement).style.animation = 'fadeOut 0.1s ease-in forwards';
      setTimeout(() => tooltip.remove(), 100);
    });
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  async function handleFileUpload(event: Event) {
    const target = event.target as HTMLInputElement;
    const file = target.files?.[0];
    
    if (!file) return;
    
    // Check file type - now supporting PDF files
    const allowedTypes = ['text/plain', 'text/markdown', 'application/pdf'];
    const allowedExtensions = ['.txt', '.md', '.pdf'];
    const hasValidType = allowedTypes.includes(file.type) || 
                        allowedExtensions.some(ext => file.name.toLowerCase().endsWith(ext));
    
    if (!hasValidType) {
      error = 'Please upload a text file (.txt, .md) or PDF file (.pdf).';
      return;
    }
    
    // Check file size (max 10MB for PDFs, 5MB for text files)
    const maxSize = file.type === 'application/pdf' ? 10 * 1024 * 1024 : 5 * 1024 * 1024;
    if (file.size > maxSize) {
      error = `File size must be less than ${file.type === 'application/pdf' ? '10MB' : '5MB'}.`;
      return;
    }
    
    // Check if file is already attached
    if (attachedFiles.some(af => af.file.name === file.name && af.file.size === file.size)) {
      error = 'This file is already attached.';
      return;
    }
    
    // Add file to attached files list
    attachedFiles = [...attachedFiles, { file }];
    
    // Clear the file input
    if (fileInput) {
      fileInput.value = '';
    }
    
    // Clear any previous errors
    error = null;
  }

  function triggerFileUpload() {
    fileInput?.click();
  }

  function removeAttachedFile(index: number) {
    attachedFiles = attachedFiles.filter((_, i) => i !== index);
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
          {#each activeChat.messages as message, i (`${activeChat.id}-${message.id}`)}
            <div class={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                          <div class="max-w-3xl">
              <div class="flex items-start gap-2">
                <div class={`rounded-2xl px-4 py-3 ${
                  message.role === 'user' 
                    ? 'bg-indigo-600 text-white' 
                    : 'bg-gray-50 text-gray-900 border border-gray-200'
                }`}>
                    {#if message.role === 'assistant'}
                      <div class="prose prose-sm max-w-none" use:setHtml={{ html: renderMarkdownLite(message.content, message.citations) }}></div>
                    {:else}
                      <div class="prose prose-sm max-w-none" use:setHtml={{ html: renderMarkdownLite(message.content) }}></div>
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
      
      <!-- Attached Files -->
      {#if attachedFiles.length > 0 && !loading}
        <div class="mb-3 p-3 rounded-lg border border-blue-200 bg-blue-50">
          <div class="flex items-center gap-2 mb-2">
            <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
            </svg>
            <span class="text-sm font-medium text-blue-900">Attached Files ({attachedFiles.length})</span>
          </div>
          <div class="space-y-2">
            {#each attachedFiles as attachedFile, index}
              <div class="flex items-center justify-between p-2 bg-white rounded border border-blue-200">
                <div class="flex items-center gap-2">
                  <svg class="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path>
                  </svg>
                  <span class="text-sm text-blue-900">{attachedFile.file.name}</span>
                  {#if attachedFile.chunksCount}
                    <span class="text-xs text-blue-600 bg-blue-100 px-2 py-1 rounded">✓ Processed ({attachedFile.chunksCount} chunks)</span>
                  {/if}
                </div>
                <button 
                  class="text-red-600 hover:text-red-800 cursor-pointer p-1" 
                  aria-label="Remove file" 
                  title="Remove file"
                  onclick={() => removeAttachedFile(index)}
                >
                  <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path>
                  </svg>
                </button>
              </div>
            {/each}
          </div>
        </div>
      {/if}

      <div class="flex items-end gap-3">
        <div class="flex-1">
          <textarea
            class="w-full resize-none rounded-2xl border border-gray-300 px-4 py-3 focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed"
            rows="1"
            placeholder="Type your message..."
            bind:value={input}
            onkeydown={onKeyDown}
            disabled={loading}
            style="min-height: 44px; max-height: 120px;"
          ></textarea>
        </div>
        
        <div class="flex gap-2">
          <!-- File Upload Button -->
          <button
            onclick={triggerFileUpload}
            disabled={isUploading || loading}
            class="p-3 bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
            aria-label="Attach document"
            title="Attach document"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"></path>
            </svg>
          </button>
          
          <!-- Send Button -->
          <button
            onclick={sendMessage}
            disabled={loading || (!input.trim() && attachedFiles.length === 0)}
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
      
      <!-- Hidden file input -->
      <input
        type="file"
        bind:this={fileInput}
        onchange={handleFileUpload}
        accept=".txt,.md,.pdf,text/*,application/pdf"
        style="display: none;"
      />
      
      <!-- Upload progress indicator -->
      {#if isUploading}
        <div class="mt-2 p-2 bg-blue-50 border border-blue-200 rounded-lg text-blue-700 text-sm text-center">
          <div class="flex items-center justify-center gap-2">
            <svg class="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path>
            </svg>
            {uploadProgress}
          </div>
        </div>
      {/if}
      
      <div class="mt-2 text-xs text-gray-500 text-center">
        Press Enter to send, Shift+Enter for new line • Click 📄 to attach documents (PDF, TXT, MD)
        <br>
        <span class="text-blue-600">💡 PDF Tip: Now supports scanned documents and handwritten text via OCR!</span>
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

  /* Citation tooltip styles */
  .citation-sup {
    transition: all 0.2s ease;
    position: relative;
  }

  .citation-sup:hover {
    transform: scale(1.05);
  }

  .citation-tooltip {
    animation: fadeIn 0.15s ease-out;
    pointer-events: none;
    backdrop-filter: blur(8px);
    border: 1px solid rgba(209, 213, 219, 0.8);
    box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(8px) scale(0.95);
    }
    to {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
  }

  @keyframes fadeOut {
    from {
      opacity: 1;
      transform: translateY(0) scale(1);
    }
    to {
      opacity: 0;
      transform: translateY(8px) scale(0.95);
    }
  }
</style>
