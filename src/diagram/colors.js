// Crease and ink colours (the render-only part of the engine's diagram.js).
// White side: a light grey line. Coloured side: a slightly darker shade of the
// paper, or a lighter one when the paper is too dark for a darker line to
// show. Colours are [r, g, b] in 0–1 (sRGB).
export const luminance=([r,g,b])=>{
  const lin=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
  return .2126*lin(r)+.7152*lin(g)+.0722*lin(b);
};
export function creaseColor(paper){
  return luminance(paper)<.06?paper.map(c=>c+(1-c)*.28):paper.map(c=>c*.78);
}
export const WHITE_SIDE=[.96,.95,.92],WHITE_CREASE=[.74,.74,.74];
// Diagram ink: dark on light paper, light on paper too dark for dark ink.
export const inkFor=paper=>luminance(paper)<.12?[.95,.95,.95]:[.1,.1,.1];
export const hexToRgb=hex=>[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
