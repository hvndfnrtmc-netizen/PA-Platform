/**
 * 高德地图 Universal Link 生成器
 * 使用 https://uri.amap.com/search?keyword= 协议：
 *   - PC 端：打开高德网页版搜索结果
 *   - 移动端：唤起高德地图 App（或跳至高德移动网页触发 App 唤醒）
 */
export function generateAmapUrl(address: string): string {
  return `https://uri.amap.com/search?keyword=${encodeURIComponent(address)}`;
}
