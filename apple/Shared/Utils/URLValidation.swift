import Foundation

/// Validates user-entered server and subscription URLs.
/// 校验用户输入的服务器与订阅地址.
func isValidHTTPURL(_ string: String) -> Bool {
    guard let url = URL(string: string),
          let scheme = url.scheme?.lowercased(),
          ["http", "https"].contains(scheme),
          url.host() != nil else {
        return false
    }
    return true
}
