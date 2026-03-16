import jwt from '../utils/jwt.js';

export function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: '未提供认证令牌'
    });
  }

  const token = authHeader.substring(7);
  const result = jwt.verify(token);

  if (!result.valid) {
    return res.status(401).json({
      success: false,
      error: result.error === 'Token expired' ? '令牌已过期' : '无效的令牌'
    });
  }

  req.user = result.payload;
  next();
}

export function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const result = jwt.verify(token);
    if (result.valid) {
      req.user = result.payload;
    }
  }
  
  next();
}

export function adminOnly(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({
      success: false,
      error: '需要管理员权限'
    });
  }
  next();
}

export default {
  authMiddleware,
  optionalAuth,
  adminOnly
};
