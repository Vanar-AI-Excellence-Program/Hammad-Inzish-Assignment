import Tesseract from 'tesseract.js';
import { fromPath } from 'pdf2pic';
import { env } from '$env/dynamic/private';

// Convert PDF to images and extract text using OCR
export async function extractTextFromPDFWithLocalOCR(pdfBuffer: Buffer, filename: string): Promise<string> {
  try {
    // Save PDF buffer to temporary file
    const fs = await import('fs/promises');
    const path = await import('path');
    const os = await import('os');
    
    const tempDir = os.tmpdir();
    const tempPdfPath = path.join(tempDir, `${Date.now()}_${filename}`);
    const tempImageDir = path.join(tempDir, `images_${Date.now()}`);
    
    // Create temp directories
    await fs.mkdir(tempImageDir, { recursive: true });
    await fs.writeFile(tempPdfPath, pdfBuffer);
    
    // Convert PDF to images
    const options = {
      density: 300, // Higher density for better OCR
      saveFilename: "page",
      savePath: tempImageDir,
      format: "png",
      width: 2480, // A4 width at 300 DPI
      height: 3508  // A4 height at 300 DPI
    };
    
    const convert = fromPath(tempPdfPath, options);
    const pageData = await convert.bulk(-1); // Convert all pages
    
    let extractedText = '';
    
    // Process each page with OCR
    for (let i = 0; i < pageData.length; i++) {
      const page = pageData[i];
      console.log(`Processing page ${i + 1}/${pageData.length}`);
      
      try {
        const result = await Tesseract.recognize(
          page.path,
          'eng', // English language
          {
            logger: m => console.log(`OCR Progress: ${m.progress * 100}%`)
          }
        );
        
        extractedText += `\n--- Page ${i + 1} ---\n`;
        extractedText += result.data.text + '\n';
        
        // Clean up page image
        await fs.unlink(page.path);
      } catch (pageError) {
        console.error(`Error processing page ${i + 1}:`, pageError);
        extractedText += `\n--- Page ${i + 1} (OCR failed) ---\n`;
      }
    }
    
    // Clean up temporary files
    try {
      await fs.unlink(tempPdfPath);
      await fs.rmdir(tempImageDir);
    } catch (cleanupError) {
      console.warn('Failed to cleanup temp files:', cleanupError);
    }
    
    return extractedText.trim();
  } catch (error) {
    console.error('Local OCR extraction failed:', error);
    throw new Error('Failed to extract text from image-based PDF using local OCR');
  }
}

// Extract text from a single image
export async function extractTextFromImageWithLocalOCR(imageBuffer: Buffer): Promise<string> {
  try {
    const result = await Tesseract.recognize(
      imageBuffer,
      'eng',
      {
        logger: m => console.log(`OCR Progress: ${m.progress * 100}%`)
      }
    );
    
    return result.data.text.trim();
  } catch (error) {
    console.error('Image OCR extraction failed:', error);
    throw new Error('Failed to extract text from image using local OCR');
  }
}
