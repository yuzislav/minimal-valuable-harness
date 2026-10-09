export async function withRetry<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3
): Promise<T> {
  let retries = 0;
  while (true) {
    try {
      return await operation();
    } catch (error: any) {
      const retriableCodes = [408, 429, 500, 502, 503, 504];
      if (retriableCodes.includes(error.status) && retries < maxRetries) {
        retries++;
        
        let waitTime = 10000 * Math.pow(2, retries - 1); 
        
        const retryMatch = error.message?.match(/Please retry in (\d+(\.\d+)?)s/);
        if (retryMatch) {
          waitTime = (parseFloat(retryMatch[1]) + 1) * 1000;
        }
        
        let secondsLeft = Math.round(waitTime / 1000);
        while (secondsLeft > 0) {
          process.stdout.write(`\r\x1b[33m[WARN] API Error (${error.status}). Retrying in ${secondsLeft}s... (Attempt ${retries}/${maxRetries})\x1b[0m\x1b[K`);
          await new Promise(resolve => setTimeout(resolve, 1000));
          secondsLeft--;
        }
        console.log('');
      } else {
        throw error;
      }
    }
  }
}
