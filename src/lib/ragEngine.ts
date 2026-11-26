import type { KnowledgeDoc, RetrievedChunk } from '../types.ts';

const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'can',
  'could',
  'will',
  'would',
  'should',
  'we',
  'you',
  'your',
  'our',
  'they',
  'their',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'how',
  'what',
  'when',
  'where',
  'who',
  'about',
  'from',
  'into',
  'also',
  'very',
  'just',
]);

export interface DocumentChunk {
  docId: string;
  docTitle: string;
  category: KnowledgeDoc['category'];
  text: string;
  tokens: string[];
}

export function tokenizeText(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f\u0900-\u097f\u3040-\u30ff\u4e00-\u9faf\s-]/g, ' ')
    .split(/\s+/)
    .map((t) => t.replace(/^-+|-+$/g, ''))
    .filter((t) => t.length >= 2 && !STOP_WORDS.has(t));
}

export function chunkKnowledgeDocs(docs: KnowledgeDoc[], maxChunkChars = 340): DocumentChunk[] {
  const chunks: DocumentChunk[] = [];

  for (const doc of docs) {
    const paragraphs = doc.content
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);

    for (const para of paragraphs) {
      if (para.length <= maxChunkChars) {
        const combined = `${doc.title} ${doc.category} ${para}`;
        chunks.push({
          docId: doc.id,
          docTitle: doc.title,
          category: doc.category,
          text: para,
          tokens: tokenizeText(combined),
        });
      } else {
        const sentences = para.split(/(?<=[.!?])\s+/);
        let current = '';
        for (const sentence of sentences) {
          if ((current + ' ' + sentence).trim().length > maxChunkChars && current.length > 0) {
            const combined = `${doc.title} ${doc.category} ${current.trim()}`;
            chunks.push({
              docId: doc.id,
              docTitle: doc.title,
              category: doc.category,
              text: current.trim(),
              tokens: tokenizeText(combined),
            });
            current = sentence;
          } else {
            current = current ? `${current} ${sentence}` : sentence;
          }
        }
        if (current.trim().length > 0) {
          const combined = `${doc.title} ${doc.category} ${current.trim()}`;
          chunks.push({
            docId: doc.id,
            docTitle: doc.title,
            category: doc.category,
            text: current.trim(),
            tokens: tokenizeText(combined),
          });
        }
      }
    }
  }

  return chunks;
}

export function retrieveRelevantChunks(
  query: string,
  docs: KnowledgeDoc[],
  topK = 3,
  minScore = 0.08
): RetrievedChunk[] {
  const queryTokens = tokenizeText(query);
  if (queryTokens.length === 0 || docs.length === 0) {
    return [];
  }

  const chunks = chunkKnowledgeDocs(docs);
  if (chunks.length === 0) {
    return [];
  }

  // Document frequency across chunks for IDF weighting
  const df = new Map<string, number>();
  for (const chunk of chunks) {
    const unique = new Set(chunk.tokens);
    for (const tok of unique) {
      df.set(tok, (df.get(tok) ?? 0) + 1);
    }
  }

  const totalChunks = chunks.length;
  const idf = (term: string) => Math.log((totalChunks + 1) / ((df.get(term) ?? 0) + 1)) + 1;

  // Query TF-IDF vector
  const qTf = new Map<string, number>();
  for (const tok of queryTokens) {
    qTf.set(tok, (qTf.get(tok) ?? 0) + 1);
  }
  const qVec = new Map<string, number>();
  let qNormSq = 0;
  for (const [tok, count] of qTf.entries()) {
    const w = (1 + Math.log(count)) * idf(tok);
    qVec.set(tok, w);
    qNormSq += w * w;
  }
  const qNorm = Math.sqrt(qNormSq);
  if (qNorm === 0) {
    return [];
  }

  const scored: RetrievedChunk[] = [];

  for (const chunk of chunks) {
    const cTf = new Map<string, number>();
    for (const tok of chunk.tokens) {
      cTf.set(tok, (cTf.get(tok) ?? 0) + 1);
    }

    let dot = 0;
    let cNormSq = 0;
    for (const [tok, count] of cTf.entries()) {
      const w = (1 + Math.log(count)) * idf(tok);
      cNormSq += w * w;
      const qWeight = qVec.get(tok);
      if (qWeight !== undefined) {
        dot += w * qWeight;
      }
    }

    // Subtle prefix/substring boost for acronyms & product terms (e.g., SOC2, GDPR, HIPAA, CRM)
    let partialMatchBoost = 0;
    const lowerText = `${chunk.docTitle} ${chunk.text}`.toLowerCase();
    for (const qTok of qTf.keys()) {
      if (qTok.length >= 3 && !cTf.has(qTok) && lowerText.includes(qTok)) {
        partialMatchBoost += 0.14;
      }
    }

    const cNorm = Math.sqrt(cNormSq);
    const cosine = cNorm > 0 ? dot / (qNorm * cNorm) : 0;
    const finalScore = Math.min(0.99, Number((cosine + partialMatchBoost).toFixed(3)));

    if (finalScore >= minScore) {
      scored.push({
        docId: chunk.docId,
        docTitle: chunk.docTitle,
        category: chunk.category,
        snippet: chunk.text,
        score: finalScore,
      });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}
