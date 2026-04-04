import { GoogleGenAI, Type } from "@google/genai";
import { collection, query, getDocs, limit, orderBy } from "firebase/firestore";
import { db } from "./firebase";

const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_GEMINI_API_KEY });

export async function analyzeInventory() {
  try {
    // Lấy dữ liệu tồn kho hiện tại
    const itemsSnapshot = await getDocs(collection(db, "items"));
    const items = itemsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Lấy các giao dịch gần đây
    const transactionsSnapshot = await getDocs(
      query(collection(db, "transactions"), orderBy("timestamp", "desc"), limit(50))
    );
    const transactions = transactionsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Lấy các ngày nghỉ
    const holidaysSnapshot = await getDocs(collection(db, "holidays"));
    const holidays = holidaysSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const prompt = `
      Bạn là một trợ lý AI chuyên về quản lý vật tư y tế cho khoa Chẩn đoán hình ảnh.
      Dưới đây là dữ liệu tồn kho hiện tại:
      ${JSON.stringify(items, null, 2)}

      Dưới đây là lịch sử giao dịch gần đây:
      ${JSON.stringify(transactions, null, 2)}

      Dưới đây là danh sách các ngày nghỉ (không làm việc):
      ${JSON.stringify(holidays, null, 2)}

      Hãy phân tích dữ liệu trên và đưa ra:
      1. Báo cáo tóm tắt tình hình tiêu thụ (lưu ý tính toán dựa trên ngày làm việc thực tế).
      2. Cảnh báo các vật tư sắp hết (dựa trên minStock).
      3. Cảnh báo các vật tư sắp hết hạn sử dụng (expiryDate).
      4. Đề xuất việc cần làm (nhập thêm hàng, kiểm tra bất thường, xử lý hàng sắp hết hạn).
      5. Phát hiện bất thường nếu có (ví dụ tiêu hao văn phòng phẩm quá nhanh).

      Trả lời bằng tiếng Việt.
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING, description: "Tóm tắt ngắn gọn tình hình kho" },
            alerts: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  type: { type: Type.STRING, enum: ["danger", "warning", "info"], description: "Mức độ nghiêm trọng" },
                  message: { type: Type.STRING, description: "Nội dung cảnh báo" },
                  item: { type: Type.STRING, description: "Tên vật tư liên quan (nếu có)" }
                },
                required: ["type", "message"]
              }
            },
            recommendations: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  action: { type: Type.STRING, description: "Hành động đề xuất" },
                  priority: { type: Type.STRING, enum: ["high", "medium", "low"], description: "Mức độ ưu tiên" },
                  reason: { type: Type.STRING, description: "Lý do đề xuất" }
                },
                required: ["action", "priority", "reason"]
              }
            },
            anomalies: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  description: { type: Type.STRING, description: "Mô tả bất thường" },
                  severity: { type: Type.STRING, enum: ["high", "medium", "low"], description: "Mức độ nghiêm trọng" }
                },
                required: ["description", "severity"]
              }
            },
            detailedAnalysis: { type: Type.STRING, description: "Phân tích chi tiết bằng định dạng Markdown" }
          },
          required: ["summary", "alerts", "recommendations", "anomalies", "detailedAnalysis"]
        }
      }
    });

    return JSON.parse(response.text);
  } catch (error) {
    console.error("AI Analysis Error:", error);
    return null;
  }
}
