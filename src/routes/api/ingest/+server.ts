import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { documents, chunks, embeddings } from '$lib/server/db/schema';
import { env } from '$env/dynamic/private';
import { randomUUID } from 'crypto';
import { extractTextFromPDFWithLocalOCR } from '$lib/server/local-ocr';

// Test function to check if OCR dependencies are available
async function testOCRDependencies() {
  try {
    console.log('Testing OCR dependencies...');
    const Tesseract = await import('tesseract.js');
    const pdf2pic = await import('pdf2pic');
    console.log('✅ OCR dependencies are available');
    return true;
  } catch (error) {
    console.error('❌ OCR dependencies not available:', error);
    return false;
  }
}

// Improved text chunking function with better chunk size and overlap
function chunkText(text: string, chunkSize: number = 800, overlap: number = 150): string[] {
  const chunks: string[] = [];
  let start = 0;
  
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length);
    let chunk = text.slice(start, end);
    
    // Try to break at sentence boundaries for better context
    if (end < text.length) {
      const lastPeriod = chunk.lastIndexOf('.');
      const lastNewline = chunk.lastIndexOf('\n');
      const lastQuestion = chunk.lastIndexOf('?');
      const lastExclamation = chunk.lastIndexOf('!');
      const breakPoint = Math.max(lastPeriod, lastNewline, lastQuestion, lastExclamation);
      
      if (breakPoint > start + chunkSize * 0.6) {
        chunk = text.slice(start, breakPoint + 1);
        start = breakPoint + 1;
      } else {
        start = end - overlap;
      }
    } else {
      start = end;
    }
    
    if (chunk.trim()) {
      chunks.push(chunk.trim());
    }
  }
  
  return chunks;
}

// Extract text from PDF using a more robust approach
async function extractTextFromPDF(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);
  
  // Check if it's a valid PDF by looking for the PDF header
  const header = new TextDecoder('ascii').decode(uint8Array.slice(0, 8));
  if (!header.startsWith('%PDF-')) {
    throw new Error('Invalid PDF file. The file does not appear to be a valid PDF.');
  }
  
  let text = '';
  
  try {
    // Try multiple text extraction methods
    const methods = [
      extractTextMethod1,
      extractTextMethod2,
      extractTextMethod3,
      extractTextMethod4, // Fallback method
      extractTextMethod5  // Compressed stream method
    ];
    
    for (const method of methods) {
      try {
        text = await method(uint8Array);
        if (text && text.length > 50) {
          break; // Use the first successful method
        }
      } catch (e) {
        console.log(`PDF extraction method failed:`, e);
        continue;
      }
    }
    
    // Clean and validate the extracted text
    text = cleanExtractedText(text);
    
    // If still no text, try a very basic extraction
    if (!text || text.length < 30) {
      text = extractTextMethod4(uint8Array);
      text = cleanExtractedText(text);
    }
    
  } catch (error) {
    console.error('Error extracting text from PDF:', error);
    throw new Error('Failed to extract text from PDF. Please ensure the PDF contains extractable text.');
  }
  
  if (!text || text.length < 30) {
    throw new Error('Could not extract sufficient text from PDF. The PDF might be image-based or corrupted. Please try a PDF with extractable text.');
  }
  
  return text;
}

// Method 1: Extract text from PDF text objects
function extractTextMethod1(uint8Array: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const pdfString = decoder.decode(uint8Array);
  
  // Look for text in parentheses (common PDF text format)
  const textMatches = pdfString.match(/\(\(([^)]+)\)\)/g) || [];
  const textContent = textMatches
    .map(match => match.replace(/\(\(|\)\)/g, ''))
    .join(' ');
  
  return textContent;
}

// Method 2: Extract text from stream objects
function extractTextMethod2(uint8Array: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const pdfString = decoder.decode(uint8Array);
  
  // Look for text in stream objects
  const streamMatches = pdfString.match(/stream\s*([\s\S]*?)\s*endstream/g) || [];
  const streamContent = streamMatches
    .map(match => match.replace(/stream\s*|\s*endstream/g, ''))
    .join(' ');
  
  return streamContent;
}

// Method 3: Extract text using BT/ET operators (begin/end text)
function extractTextMethod3(uint8Array: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const pdfString = decoder.decode(uint8Array);
  
  // Look for text between BT (begin text) and ET (end text) operators
  const textMatches = pdfString.match(/BT\s*([\s\S]*?)\s*ET/g) || [];
  const textContent = textMatches
    .map(match => match.replace(/BT\s*|\s*ET/g, ''))
    .join(' ');
  
  return textContent;
}

// Method 4: Basic fallback - extract any readable text
function extractTextMethod4(uint8Array: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const pdfString = decoder.decode(uint8Array);
  
  // Extract any text that looks like readable content
  const words = pdfString
    .split(/\s+/)
    .filter(word => {
      // Filter out PDF commands, numbers, and very short strings
      if (word.length < 3) return false;
      if (/^[0-9\s\-\.]+$/.test(word)) return false;
      if (/^[A-Z]{2,}$/.test(word)) return false; // All caps commands
      if (/^[\/\(\)\[\]\{\}]+$/.test(word)) return false; // PDF syntax
      return true;
    })
    .join(' ');
  
  return words;
}

// Method 5: Extract text from compressed streams (for some PDFs)
function extractTextMethod5(uint8Array: Uint8Array): string {
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const pdfString = decoder.decode(uint8Array);
  
  // Look for text in compressed streams
  const compressedMatches = pdfString.match(/FlateDecode[^>]*stream\s*([\s\S]*?)\s*endstream/g) || [];
  let text = '';
  
  for (const match of compressedMatches) {
    try {
      // Try to extract text from compressed content
      const streamContent = match.replace(/FlateDecode[^>]*stream\s*|\s*endstream/g, '');
      // Basic text extraction from stream content
      const textMatches = streamContent.match(/\(([^)]+)\)/g) || [];
      text += textMatches.map(m => m.replace(/[\(\)]/g, '')).join(' ');
    } catch (e) {
      continue;
    }
  }
  
  return text;
}

// Clean extracted text to remove binary data and invalid characters
function cleanExtractedText(text: string): string {
  if (!text) return '';
  
  // Remove null bytes and other invalid UTF-8 characters
  text = text.replace(/\x00/g, ''); // Remove null bytes
  text = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, ''); // Remove control characters
  
  // Clean up PDF-specific artifacts
  text = text
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\')
    .replace(/\\([0-9]{3})/g, (match, code) => String.fromCharCode(parseInt(code, 8)))
    .replace(/\\([0-9a-fA-F]{2})/g, (match, code) => String.fromCharCode(parseInt(code, 16)));
  
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  // Remove PDF-specific commands and operators
  text = text
    .replace(/\b(BT|ET|Td|Tj|TJ|Tm|Tf|Tc|Tw|Tz|TL|Ts|Tr|Tk|Tg|Tv|Th|Tl|Ts|Tc|Tw|Tz|TL|Ts|Tr|Tk|Tg|Tv|Th|Tl)\b/g, '')
    .replace(/\b(q|Q|cm|w|J|j|M|d|ri|i|gs|g|G|rg|RG|k|K|s|S|f|F|f\*|B|b|b\*|n|W|W\*|cs|CS|sc|SC|scn|SCN|sh|Do|MP|DP|BMC|BDC|EMC|BX|EX)\b/g, '')
    .replace(/\[[^\]]*\]/g, '') // Remove array definitions
    .replace(/\{[^}]*\}/g, '') // Remove dictionary definitions
    .replace(/\/[A-Za-z0-9]+\s+[0-9]+\s+R/g, '') // Remove font references
    .replace(/\/[A-Za-z0-9]+\s+[0-9]+\s+[0-9]+\s+Tm/g, ''); // Remove text matrix
  
  // Remove excessive whitespace again
  text = text.replace(/\s+/g, ' ').trim();
  
  // Ensure the text is valid UTF-8
  try {
    // Test if the text can be encoded/decoded as UTF-8
    const encoder = new TextEncoder();
    const decoder = new TextDecoder('utf-8');
    const bytes = encoder.encode(text);
    const decoded = decoder.decode(bytes);
    
    // If there's a significant difference, use the decoded version
    if (Math.abs(decoded.length - text.length) > text.length * 0.1) {
      text = decoded;
    }
  } catch (e) {
    console.warn('UTF-8 validation failed, using original text');
  }
  
  return text;
}

// Call embedding API
async function getEmbeddings(texts: string[]): Promise<number[][]> {
  const response = await fetch(`${env.EMBEDDING_API_URL}/embed`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ texts }),
  });

  if (!response.ok) {
    throw new Error(`Embedding API error: ${response.statusText}`);
  }

  const data = await response.json();
  return data.embeddings;
}

export const POST: RequestHandler = async ({ request, locals }) => {
  try {
    const session = await locals.auth();
    if (!session?.user?.id) {
      return json({ error: 'Unauthorized' }, { status: 401 });
    }

    let title: string;
    let content: string;
    let source: string;
    let mimeType: string;

    // Check if this is a file upload (multipart/form-data) or JSON
    const contentType = request.headers.get('content-type') || '';
    
    if (contentType.includes('multipart/form-data')) {
      // Handle file upload
      const formData = await request.formData();
      const file = formData.get('file') as File;
      
      if (!file) {
        return json({ error: 'No file provided' }, { status: 400 });
      }

      title = file.name;
      source = 'File Upload';
      mimeType = file.type;

      // Extract text based on file type
      if (file.type === 'application/pdf') {
        console.log(`Processing PDF: ${file.name} (${file.size} bytes)`);
        
        // Test OCR dependencies
        await testOCRDependencies();
        try {
          // First try regular text extraction
          console.log('Attempting regular PDF text extraction...');
          content = await extractTextFromPDF(file);
          console.log(`Regular extraction result: ${content ? content.length : 0} characters`);
          
          // If regular extraction fails or produces poor results, try OCR
          if (!content || content.length < 100) {
            console.log('Regular PDF extraction failed, trying OCR...');
            const fileBuffer = Buffer.from(await file.arrayBuffer());
            content = await extractTextFromPDFWithLocalOCR(fileBuffer, file.name);
            console.log(`OCR extraction result: ${content ? content.length : 0} characters`);
          }
        } catch (error) {
          console.log('Regular PDF extraction failed, trying OCR...', error);
          try {
            const fileBuffer = Buffer.from(await file.arrayBuffer());
            content = await extractTextFromPDFWithLocalOCR(fileBuffer, file.name);
            console.log(`OCR extraction result: ${content ? content.length : 0} characters`);
          } catch (ocrError) {
            console.error('OCR also failed:', ocrError);
            throw new Error('Failed to extract text from PDF using both regular extraction and OCR. Please ensure the PDF contains readable content.');
          }
        }
      } else if (file.type === 'text/plain' || file.type === 'text/markdown') {
        content = await file.text();
      } else {
        return json({ error: 'Unsupported file type. Please upload PDF or text files only.' }, { status: 400 });
      }
    } else {
      // Handle JSON data (existing functionality)
      const body = await request.json();
      ({ title, content, source, mimeType } = body);

      if (!title || !content || !source) {
        return json({ error: 'Missing required fields: title, content, source' }, { status: 400 });
      }
    }

    // Check if embedding API is available
    if (!env.EMBEDDING_API_URL) {
      return json({ error: 'Embedding API not configured' }, { status: 500 });
    }

    // Create document
    const documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      title,
      source,
      mimeType: mimeType || 'text/plain',
    });

    // Validate content before chunking
    console.log(`Content validation: ${content ? content.length : 0} characters`);
    console.log(`Content preview: ${content ? content.substring(0, 200) : 'NO CONTENT'}...`);
    
    if (!content || content.trim().length === 0) {
      return json({ error: 'No content extracted from document' }, { status: 400 });
    }
    
    // Additional validation for PDF content
    if (mimeType === 'application/pdf') {
      // Check if the content contains mostly readable text
      const readableChars = content.replace(/[^a-zA-Z0-9\s]/g, '').length;
      const totalChars = content.length;
      const readabilityRatio = readableChars / totalChars;
      
      // More lenient validation for OCR-extracted content
      const minReadabilityRatio = 0.1; // Lower threshold for OCR content
      const minContentLength = 50; // Lower minimum length for OCR content
      
      if (readabilityRatio < minReadabilityRatio || content.length < minContentLength) {
        console.log(`PDF readability ratio: ${(readabilityRatio * 100).toFixed(1)}%`);
        console.log(`Content length: ${content.length} characters`);
        console.log(`Content preview: ${content.substring(0, 200)}...`);
        
        // Try to provide more specific guidance based on content analysis
        let guidance = '';
        if (content.includes('stream') && content.includes('endstream')) {
          guidance = 'This PDF appears to contain compressed or encoded content. OCR processing may help.';
        } else if (content.length < minContentLength) {
          guidance = 'This PDF appears to be empty or contains very little text. OCR processing may help.';
        } else if (readableChars < 20) {
          guidance = 'This PDF appears to be image-based (scanned document). OCR processing may help.';
        } else {
          guidance = 'This PDF contains mostly non-text content. OCR processing may help.';
        }
        
        return json({ 
          error: `PDF Text Extraction Issue: ${guidance}\n\nPossible solutions:\n1. Use a PDF with actual text content (not scanned images)\n2. Convert the PDF to text format first\n3. Try a different PDF file\n4. Contact support if OCR processing is needed` 
        }, { status: 400 });
      }
    }
    
    // Split content into chunks with improved chunking
    console.log(`Creating chunks from ${content.length} characters...`);
    const textChunks = chunkText(content);
    console.log(`Created ${textChunks.length} chunks`);
    
    if (textChunks.length === 0) {
      return json({ error: 'No content chunks generated' }, { status: 400 });
    }

    // Generate embeddings
    console.log('Generating embeddings...');
    const embeddingsList = await getEmbeddings(textChunks);
    console.log(`Generated ${embeddingsList.length} embeddings`);

    // Insert chunks and embeddings
    const chunkInserts = textChunks.map((chunk, idx) => ({
      id: randomUUID(),
      documentId,
      idx,
      content: chunk,
    }));

    console.log('Inserting chunks into database...');
    await db.insert(chunks).values(chunkInserts);
    console.log(`Inserted ${chunkInserts.length} chunks`);

    // Insert embeddings
    const embeddingInserts = embeddingsList.map((embedding, idx) => ({
      chunkId: chunkInserts[idx].id,
      embedding: JSON.stringify(embedding),
    }));

    console.log('Inserting embeddings into database...');
    await db.insert(embeddings).values(embeddingInserts);
    console.log(`Inserted ${embeddingInserts.length} embeddings`);

    return json({
      success: true,
      documentId,
      chunksCount: textChunks.length,
      message: `Successfully ingested document "${title}" with ${textChunks.length} chunks`
    });

  } catch (error) {
    console.error('Error in ingest API:', error);
    return json({ error: error instanceof Error ? error.message : 'Failed to ingest document' }, { status: 500 });
  }
};
