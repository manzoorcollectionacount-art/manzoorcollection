import { useEffect, useRef, useCallback } from 'react';

interface UseBarcodeScannerOptions {
  onScan: (barcode: string) => void;
}

export function useBarcodeScanner({ onScan }: UseBarcodeScannerOptions) {
  const keys = useRef<string[]>([]);
  const timeout = useRef<NodeJS.Timeout | null>(null);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey) return;

    if (e.key === 'Enter' || e.key === 'Tab') {
      if (keys.current.length > 0) {
        const barcode = keys.current.join('');
        
        if (barcode.length >= 3) {
          onScan(barcode);
          
          
          const activeEl = document.activeElement as HTMLInputElement;
          if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA') && activeEl.type !== 'submit') {
             let newValue = activeEl.value;
             if (activeEl.value.endsWith(barcode)) {
               newValue = activeEl.value.slice(0, -barcode.length);
             } else if (activeEl.value === barcode) {
               newValue = '';
             }
             
             if (newValue !== activeEl.value) {
                const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                  activeEl.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype, 
                  "value"
                )?.set;
                
                if (nativeInputValueSetter) {
                  nativeInputValueSetter.call(activeEl, newValue);
                  activeEl.dispatchEvent(new Event('input', { bubbles: true }));
                }
             }
          }
e.preventDefault();
        }
        keys.current = [];
        if (timeout.current) clearTimeout(timeout.current);
      }
      return;
    }

    if (e.key.length === 1) {
      keys.current.push(e.key);
      
      if (timeout.current) {
        clearTimeout(timeout.current);
      }
      
      timeout.current = setTimeout(() => {
        keys.current = [];
      }, 30); // 30ms is usually fast enough to filter human typing vs barcode scanner
    }
  }, [onScan]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      if (timeout.current) clearTimeout(timeout.current);
    };
  }, [handleKeyDown]);
}
