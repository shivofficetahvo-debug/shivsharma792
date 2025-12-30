
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Upload, FileText, Scissors, Download, RefreshCw, Zap, Save, Trash2, ChevronLeft, ChevronRight, Layers, CheckCircle2 } from 'lucide-react';
import { CropArea, PDFMetadata } from './types';
import { detectShippingLabel } from './services/geminiService';

const pdfjsLib = (window as any).pdfjsLib;
const JSZip = (window as any).JSZip;
const saveAs = (window as any).saveAs;

pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

const App: React.FC = () => {
  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<any>(null);
  const [metadata, setMetadata] = useState<PDFMetadata | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [aiAnalyzing, setAiAnalyzing] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ current: number; total: number } | null>(null);
  const [crop, setCrop] = useState<CropArea>({ x: 10, y: 10, width: 80, height: 40 });
  const [savedPresets, setSavedPresets] = useState<CropArea[]>(() => {
    const saved = localStorage.getItem('label_crop_presets');
    return saved ? JSON.parse(saved) : [];
  });

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const renderPageToCanvas = async (pdfDoc: any, pageNumber: number, targetCanvas: HTMLCanvasElement) => {
    const page = await pdfDoc.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2 });
    targetCanvas.height = viewport.height;
    targetCanvas.width = viewport.width;
    const context = targetCanvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;
    return targetCanvas;
  };

  const renderCurrentPage = useCallback(async () => {
    if (!pdf || !canvasRef.current) return;
    setLoading(true);
    try {
      await renderPageToCanvas(pdf, currentPage, canvasRef.current);
    } catch (err) {
      console.error("Error rendering PDF:", err);
    } finally {
      setLoading(false);
    }
  }, [pdf, currentPage]);

  useEffect(() => {
    if (pdf) renderCurrentPage();
  }, [pdf, currentPage, renderCurrentPage]);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const uploadedFile = event.target.files?.[0];
    if (uploadedFile && uploadedFile.type === 'application/pdf') {
      setLoading(true);
      setFile(uploadedFile);
      const reader = new FileReader();
      reader.onload = async (e) => {
        const typedarray = new Uint8Array(e.target?.result as ArrayBuffer);
        try {
          const loadingTask = pdfjsLib.getDocument(typedarray);
          const pdfDoc = await loadingTask.promise;
          setPdf(pdfDoc);
          setMetadata({ numPages: pdfDoc.numPages, fileName: uploadedFile.name });
          setCurrentPage(1);
        } catch (err) {
          console.error("PDF loading error:", err);
          alert("Failed to load PDF.");
        }
      };
      reader.readAsArrayBuffer(uploadedFile);
    }
  };

  const handleAutoDetect = async () => {
    if (!canvasRef.current) return;
    setAiAnalyzing(true);
    try {
      const dataUrl = canvasRef.current.toDataURL('image/jpeg', 0.8);
      const result = await detectShippingLabel(dataUrl);
      if (result && result.label_found) {
        setCrop(result.crop_area);
      } else {
        alert("AI could not find a clear shipping label on this page.");
      }
    } catch (err) {
      console.error(err);
      alert("AI Analysis failed.");
    } finally {
      setAiAnalyzing(false);
    }
  };

  const getCroppedDataUrl = (canvas: HTMLCanvasElement, cropArea: CropArea) => {
    const cropX = (cropArea.x / 100) * canvas.width;
    const cropY = (cropArea.y / 100) * canvas.height;
    const cropWidth = (cropArea.width / 100) * canvas.width;
    const cropHeight = (cropArea.height / 100) * canvas.height;

    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = cropWidth;
    tempCanvas.height = cropHeight;
    const ctx = tempCanvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, cropX, cropY, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
    return tempCanvas.toDataURL('image/png');
  };

  const handleDownloadSingle = () => {
    if (!canvasRef.current) return;
    const dataUrl = getCroppedDataUrl(canvasRef.current, crop);
    if (dataUrl) {
      const link = document.createElement('a');
      link.download = `label_page_${currentPage}.png`;
      link.href = dataUrl;
      link.click();
    }
  };

  const handleBulkExport = async () => {
    if (!pdf || !metadata) return;
    const zip = new JSZip();
    const offscreenCanvas = document.createElement('canvas');
    setExportProgress({ current: 0, total: metadata.numPages });

    try {
      for (let i = 1; i <= metadata.numPages; i++) {
        setExportProgress({ current: i, total: metadata.numPages });
        await renderPageToCanvas(pdf, i, offscreenCanvas);
        const dataUrl = getCroppedDataUrl(offscreenCanvas, crop);
        if (dataUrl) {
          const base64Data = dataUrl.split(',')[1];
          zip.file(`label_page_${i}.png`, base64Data, { base64: true });
        }
      }
      const content = await zip.generateAsync({ type: 'blob' });
      saveAs(content, `cropped_labels_${metadata.fileName.replace('.pdf', '')}.zip`);
    } catch (err) {
      console.error("Bulk export failed:", err);
      alert("Error during bulk export.");
    } finally {
      setExportProgress(null);
    }
  };

  const handleMouseDown = (e: React.MouseEvent, type: string) => {
    const startX = e.clientX;
    const startY = e.clientY;
    const initialCrop = { ...crop };
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const onMouseMove = (moveEvent: MouseEvent) => {
      const deltaX = ((moveEvent.clientX - startX) / rect.width) * 100;
      const deltaY = ((moveEvent.clientY - startY) / rect.height) * 100;
      if (type === 'move') {
        setCrop({
          ...initialCrop,
          x: Math.max(0, Math.min(100 - initialCrop.width, initialCrop.x + deltaX)),
          y: Math.max(0, Math.min(100 - initialCrop.height, initialCrop.y + deltaY)),
        });
      } else if (type === 'br') {
        setCrop({
          ...initialCrop,
          width: Math.max(5, Math.min(100 - initialCrop.x, initialCrop.width + deltaX)),
          height: Math.max(5, Math.min(100 - initialCrop.y, initialCrop.height + deltaY)),
        });
      }
    };
    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#f8fafc]">
      {/* Bulk Progress Overlay */}
      {exportProgress && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 text-white text-center">
          <div className="max-w-md w-full bg-white/10 p-8 rounded-3xl border border-white/20 shadow-2xl">
            <RefreshCw className="animate-spin mb-6 mx-auto text-blue-400" size={48} />
            <h2 className="text-2xl font-bold mb-2">Generating Labels</h2>
            <p className="text-blue-200 mb-6 font-medium">Processing page {exportProgress.current} of {exportProgress.total}</p>
            <div className="w-full h-3 bg-white/10 rounded-full overflow-hidden">
              <div 
                className="h-full bg-blue-500 transition-all duration-300 shadow-[0_0_15px_rgba(59,130,246,0.5)]" 
                style={{ width: `${(exportProgress.current / exportProgress.total) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <header className="bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-blue-600 p-2.5 rounded-xl text-white shadow-lg shadow-blue-100">
            <Layers size={22} />
          </div>
          <div>
            <h1 className="font-bold text-lg text-gray-900 tracking-tight">SmartLabel Pro</h1>
            <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">Multi-Page Batch Processor</p>
          </div>
        </div>
        
        {file && (
          <div className="flex items-center gap-3">
            <button 
              onClick={handleAutoDetect}
              disabled={aiAnalyzing}
              className={`hidden md:flex items-center gap-2 px-5 py-2.5 rounded-full text-xs font-bold transition-all ${
                aiAnalyzing ? 'bg-gray-100 text-gray-400' : 'bg-blue-50 text-blue-600 hover:bg-blue-100 active:scale-95'
              }`}
            >
              <Zap size={14} className={aiAnalyzing ? "animate-pulse" : ""} />
              {aiAnalyzing ? 'AI ANALYZING...' : 'AUTO-DETECT'}
            </button>
            <button 
              onClick={handleBulkExport}
              className="flex items-center gap-2 bg-gray-900 hover:bg-black text-white px-6 py-2.5 rounded-full text-xs font-bold shadow-xl shadow-gray-200 transition-all active:scale-95"
            >
              <Download size={14} />
              EXPORT ALL ({metadata?.numPages})
            </button>
          </div>
        )}
      </header>

      <main className="flex-1 flex flex-col md:flex-row overflow-hidden">
        {/* Sidebar */}
        <div className="w-full md:w-80 bg-white border-r border-gray-100 p-6 flex flex-col gap-8 custom-scrollbar overflow-y-auto">
          <section>
            <h2 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Input Source</h2>
            {!file ? (
              <label className="flex flex-col items-center justify-center w-full h-40 border-2 border-dashed border-gray-100 rounded-2xl cursor-pointer hover:bg-blue-50/30 hover:border-blue-200 transition-all group">
                <Upload className="text-gray-300 group-hover:text-blue-400 mb-3 transition-colors" size={28} />
                <span className="text-xs font-bold text-gray-400 group-hover:text-blue-500 px-4 text-center">DROP MULTI-PAGE PDF HERE</span>
                <input type="file" className="hidden" accept=".pdf" onChange={handleFileUpload} />
              </label>
            ) : (
              <div className="bg-blue-50/50 p-4 rounded-2xl border border-blue-100 relative group">
                <div className="flex items-center gap-3">
                  <div className="bg-blue-600 p-2 rounded-lg text-white">
                    <FileText size={18} />
                  </div>
                  <div className="overflow-hidden">
                    <p className="text-xs font-bold text-gray-900 truncate">{metadata?.fileName}</p>
                    <p className="text-[10px] text-blue-600 font-bold">{metadata?.numPages} TOTAL PAGES</p>
                  </div>
                </div>
                <button 
                  onClick={() => { setFile(null); setPdf(null); }}
                  className="absolute -top-2 -right-2 bg-white text-gray-400 hover:text-red-500 shadow-lg rounded-full p-1.5 border border-gray-100 transition-colors"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            )}
          </section>

          {file && (
            <>
              <section className="flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em]">Crop Presets</h2>
                  <button onClick={() => {
                    const newPresets = [...savedPresets, crop];
                    setSavedPresets(newPresets);
                    localStorage.setItem('label_crop_presets', JSON.stringify(newPresets));
                  }} className="text-blue-600 hover:bg-blue-50 p-1.5 rounded-lg transition-colors">
                    <Save size={16} />
                  </button>
                </div>
                <div className="grid grid-cols-1 gap-2">
                  {savedPresets.length > 0 ? (
                    savedPresets.map((p, idx) => (
                      <button
                        key={idx}
                        onClick={() => setCrop(p)}
                        className="text-left px-4 py-3 rounded-xl border border-gray-100 hover:border-blue-200 hover:bg-blue-50 text-[11px] font-bold text-gray-600 transition-all flex items-center justify-between group"
                      >
                        <div className="flex items-center gap-2">
                          <CheckCircle2 size={12} className="text-blue-400 opacity-0 group-hover:opacity-100" />
                          <span>TEMPLATE {idx + 1}</span>
                        </div>
                        <RefreshCw size={10} className="text-gray-300" />
                      </button>
                    ))
                  ) : (
                    <p className="text-[10px] text-gray-400 italic">No templates. Save one for daily use.</p>
                  )}
                </div>
              </section>

              <section>
                <h2 className="text-[11px] font-black text-gray-400 uppercase tracking-[0.2em] mb-4">Preview Navigator</h2>
                <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3 border border-gray-100">
                  <button 
                    disabled={currentPage === 1} 
                    onClick={() => setCurrentPage(p => p - 1)}
                    className="p-2 hover:bg-white rounded-lg shadow-sm disabled:opacity-20 transition-all"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <div className="text-center">
                    <p className="text-[10px] font-black text-gray-400 mb-0.5">PAGE</p>
                    <span className="text-sm font-black text-gray-800">{currentPage} of {metadata?.numPages}</span>
                  </div>
                  <button 
                    disabled={currentPage === metadata?.numPages}
                    onClick={() => setCurrentPage(p => p + 1)}
                    className="p-2 hover:bg-white rounded-lg shadow-sm disabled:opacity-20 transition-all"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </section>

              <div className="mt-auto p-5 bg-gradient-to-br from-blue-600 to-blue-700 rounded-3xl text-white shadow-xl shadow-blue-100">
                <div className="flex items-center justify-between mb-3">
                  <p className="text-[10px] font-bold opacity-70 uppercase tracking-widest">Active Selector</p>
                  <Scissors size={14} className="opacity-50" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-white/10 p-2 rounded-xl border border-white/10">
                    <p className="text-[9px] font-black opacity-60">WIDTH</p>
                    <p className="text-xs font-black">{Math.round(crop.width)}%</p>
                  </div>
                  <div className="bg-white/10 p-2 rounded-xl border border-white/10">
                    <p className="text-[9px] font-black opacity-60">HEIGHT</p>
                    <p className="text-xs font-black">{Math.round(crop.height)}%</p>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Workspace */}
        <div className="flex-1 overflow-auto p-4 md:p-12 flex items-start justify-center relative bg-[#fdfdfe]">
          {!file ? (
            <div className="flex flex-col items-center justify-center text-center max-w-sm mt-24">
              <div className="w-24 h-24 bg-white rounded-full flex items-center justify-center mb-8 shadow-2xl shadow-blue-50 text-blue-100 border border-gray-50">
                <Layers size={48} />
              </div>
              <h3 className="text-xl font-black text-gray-900 mb-3 tracking-tight">Batch PDF Processor</h3>
              <p className="text-gray-400 text-xs font-medium leading-relaxed uppercase tracking-wider">
                Upload a document with multiple labels. Select once, crop all pages instantly.
              </p>
            </div>
          ) : (
            <div className="relative group p-2" ref={containerRef}>
              {loading && (
                <div className="absolute inset-0 bg-white/80 backdrop-blur-sm z-10 flex items-center justify-center rounded-2xl">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-12 h-12 border-4 border-blue-600/10 border-t-blue-600 rounded-full animate-spin" />
                    <span className="text-[10px] font-black text-blue-600 tracking-widest">RENDERING PAGE...</span>
                  </div>
                </div>
              )}
              
              <canvas ref={canvasRef} className="max-w-full h-auto bg-white rounded-2xl shadow-[0_32px_64px_-12px_rgba(0,0,0,0.14)]" />

              <div 
                className="crop-overlay group ring-2 ring-blue-500/20"
                style={{
                  left: `${crop.x}%`,
                  top: `${crop.y}%`,
                  width: `${crop.width}%`,
                  height: `${crop.height}%`,
                }}
                onMouseDown={(e) => handleMouseDown(e, 'move')}
              >
                {/* Guidelines */}
                <div className="absolute inset-0 grid grid-cols-3 pointer-events-none opacity-20 group-hover:opacity-40 transition-opacity">
                  <div className="border-r border-blue-500 border-dashed"></div>
                  <div className="border-r border-blue-500 border-dashed"></div>
                  <div></div>
                </div>
                <div className="absolute inset-0 grid grid-rows-3 pointer-events-none opacity-20 group-hover:opacity-40 transition-opacity">
                  <div className="border-b border-blue-500 border-dashed"></div>
                  <div className="border-b border-blue-500 border-dashed"></div>
                  <div></div>
                </div>

                <div 
                  className="crop-handle -bottom-1.5 -right-1.5 cursor-nwse-resize shadow-lg ring-4 ring-blue-500/10 active:scale-125 transition-transform"
                  onMouseDown={(e) => { e.stopPropagation(); handleMouseDown(e, 'br'); }}
                />

                <div className="absolute -top-8 left-0 flex items-center gap-2 bg-gray-900 text-white text-[9px] px-2.5 py-1 rounded-full font-black uppercase tracking-wider shadow-xl opacity-0 group-hover:opacity-100 transition-all transform translate-y-2 group-hover:translate-y-0">
                  <Layers size={10} className="text-blue-400" />
                  Apply to all {metadata?.numPages} pages
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer / Info */}
      <footer className="bg-white border-t border-gray-100 px-6 py-3 flex justify-between items-center text-[10px] text-gray-400 font-bold uppercase tracking-widest">
        <div>SmartLabel Engine v2.0 • Batch Optimized</div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-500"></div> System Ready</span>
          <span className="hidden md:inline">Gemini AI Detection Enabled</span>
        </div>
      </footer>
    </div>
  );
};

export default App;
