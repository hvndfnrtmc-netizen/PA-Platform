/**
 * 政府公文生成工具库
 * 格式规范参考：AI Agent 政府公文生成器工具分享.docx
 *
 * 提供两个核心方法：
 * - buildGovDoc()     Form 模式：从表单字段生成符合政府规范的 Word 文档 Buffer
 * - detectPlaceholders() Template 模式：从 .docx 二进制中提取 {{...}} 占位符列表
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  AlignmentType,
  BorderStyle,
  Footer,
  PageNumber,
} from "docx";
import PizZip from "pizzip";

// ── 单位转换工具 ──────────────────────────────────────────────────

const mmToTwip   = (mm: number) => Math.round((mm / 25.4) * 1440);
const ptToHalfPt = (pt: number) => pt * 2;
const ptToTwip   = (pt: number) => Math.round(pt * 20);

// ── 段落类型判断（与 HTML 工具逻辑一致） ─────────────────────────

const isLevel1  = (t: string) => /^[一二三四五六七八九十百]+、/.test(t);
const isLevel2  = (t: string) => /^[(（][一二三四五六七八九十百]+[)）]/.test(t);
const isHeading = (t: string) => isLevel1(t) || isLevel2(t);

// ── 共用行距 ──────────────────────────────────────────────────────
const STD_SPACING = { line: 560, lineRule: "exact" as const };

// ── 公文格式接口 ──────────────────────────────────────────────────

export interface GovDocFields {
  header?:      string; // 红头主体（公文抬头）
  mainTitle:    string; // 主标题
  subtitle?:    string; // 副标题（选填）
  salutation?:  string; // 称呼（选填）
  body:         string; // 正文（已完成占位符替换）
  signer?:      string; // 落款署名
  date?:        string; // 成文日期
}

/**
 * 根据表单字段生成符合政府公文规范的 .docx Buffer
 */
export async function buildGovDoc(fields: GovDocFields): Promise<Buffer> {
  const { header, mainTitle, subtitle, salutation, body, signer, date } = fields;
  const children: Paragraph[] = [];

  // ── 1. 抬头行（红头）──────────────────────────────────────────
  if (header) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: {
          before:   ptToTwip(17),
          after:    ptToTwip(16.5),
          line:     560,
          lineRule: "atLeast",
        },
        border: {
          bottom: {
            color: "E1251B",
            space: 16,
            style: BorderStyle.SINGLE,
            size:  24,
          },
        },
        children: [
          new TextRun({
            text:             header,
            font:             { name: "SimSun", eastAsia: "SimSun" },
            size:             ptToHalfPt(48),
            bold:             true,
            color:            "E1251B",
            characterSpacing: ptToTwip(2),
          }),
        ],
      })
    );
  }

  // ── 2. 主标题 ──────────────────────────────────────────────────
  children.push(
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing:   STD_SPACING,
      children: [
        new TextRun({
          text: mainTitle,
          font: { name: "方正小标宋简体", eastAsia: "方正小标宋简体" },
          size: ptToHalfPt(22),
        }),
      ],
    })
  );

  // ── 3. 副标题 ──────────────────────────────────────────────────
  if (subtitle) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing:   STD_SPACING,
        children: [
          new TextRun({
            text: `——${subtitle}`,
            font: { name: "楷体_GB2312", eastAsia: "楷体_GB2312" },
            size: ptToHalfPt(16),
          }),
        ],
      })
    );
  }

  // ── 4. 称呼 ────────────────────────────────────────────────────
  children.push(new Paragraph({ spacing: STD_SPACING }));
  if (salutation) {
    children.push(
      new Paragraph({
        alignment: AlignmentType.LEFT,
        spacing:   STD_SPACING,
        children: [
          new TextRun({
            text: salutation,
            font: { name: "仿宋_GB2312", eastAsia: "仿宋_GB2312" },
            size: ptToHalfPt(16),
          }),
        ],
      })
    );
    children.push(new Paragraph({ spacing: STD_SPACING }));
  }

  // ── 5. 正文 ────────────────────────────────────────────────────
  const lines = body.split("\n").map(l => l.trim()).filter(l => l.length > 0);
  lines.forEach((text, idx) => {
    let fontName = "仿宋_GB2312";
    if      (isLevel1(text)) fontName = "黑体";
    else if (isLevel2(text)) fontName = "楷体_GB2312";

    children.push(
      new Paragraph({
        spacing: STD_SPACING,
        indent:  { firstLine: 640 },
        children: [
          new TextRun({
            text,
            font: { name: fontName, eastAsia: fontName },
            size: ptToHalfPt(16),
          }),
        ],
      })
    );

    // 一级标题前插入空行分隔
    const next = lines[idx + 1];
    if (next && !isHeading(text) && isLevel1(next)) {
      children.push(new Paragraph({ spacing: STD_SPACING }));
    }
  });

  // ── 6. 落款 ────────────────────────────────────────────────────
  if (signer || date) {
    children.push(new Paragraph({ spacing: STD_SPACING }));
    if (signer) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing:   STD_SPACING,
          children: [
            new TextRun({
              text: signer,
              font: { name: "楷体_GB2312", eastAsia: "楷体_GB2312" },
              size: ptToHalfPt(16),
            }),
          ],
        })
      );
    }
    if (date) {
      children.push(
        new Paragraph({
          alignment: AlignmentType.RIGHT,
          spacing:   STD_SPACING,
          children: [
            new TextRun({
              text: date,
              font: { name: "楷体_GB2312", eastAsia: "楷体_GB2312" },
              size: ptToHalfPt(16),
            }),
          ],
        })
      );
    }
  }

  // ── 7. 组装文档 ────────────────────────────────────────────────
  const doc = new Document({
    sections: [
      {
        properties: {
          page: {
            size: {
              width:  mmToTwip(210),
              height: mmToTwip(297),
            },
            margin: {
              top:    mmToTwip(28),
              bottom: mmToTwip(28),
              left:   mmToTwip(28),
              right:  mmToTwip(28),
            },
          },
        },
        footers: {
          default: new Footer({
            children: [
              new Paragraph({
                alignment: AlignmentType.CENTER,
                children: [
                  new TextRun({
                    children: ["— ", PageNumber.CURRENT, " —"],
                    font:     { name: "仿宋_GB2312", eastAsia: "仿宋_GB2312" },
                    size:     ptToHalfPt(12),
                  }),
                ],
              }),
            ],
          }),
        },
        children,
      },
    ],
  });

  return Buffer.from(await Packer.toBuffer(doc));
}

// ── 占位符检测（Template 模式辅助） ──────────────────────────────

/**
 * 从 docx 二进制 Buffer 中提取所有 {{key}} 占位符。
 * 使用 PizZip 正确解析 docx 内部 XML，避免直接 toString("utf8") 破坏二进制数据。
 * 返回去重后的 key 数组（不含花括号）。
 */
export function detectPlaceholders(docxBuffer: Buffer): string[] {
  try {
    const zip  = new PizZip(docxBuffer);
    const keys = new Set<string>();

    // 扫描正文 + 页眉页脚 XML
    const filesToScan = [
      "word/document.xml",
      ...Object.keys(zip.files).filter(
        f => /^word\/(header|footer)\d*\.xml$/.test(f)
      ),
    ];

    for (const fname of filesToScan) {
      const xml = zip.file(fname)?.asText() ?? "";
      // 先去掉 XML 标签干扰，再匹配 {{...}}
      // 注意：Word 可能把 {{ 和 }} 放在同一个 <w:t> 里，也可能跨 <w:r> 分割
      // 这里先匹配纯 XML 文本节点中完整的 {{key}}
      for (const m of xml.matchAll(/\{\{([^{}]{1,64})\}\}/g)) {
        keys.add(m[1].trim());
      }
    }

    return Array.from(keys);
  } catch {
    // 解析失败时返回空（不报错，让后续步骤继续）
    return [];
  }
}
