async function runButtonAction(target, key, task, field = 'pendingAction') {
  if (!target || !target.setData || !target.data) {
    throw new Error('runButtonAction 需要传入页面或组件实例')
  }

  if (target.data[field]) {
    return false
  }

  try {
    target.setData({ [field]: key })
  } catch (e) {
    // 页面可能已销毁，忽略 setData 错误
    return false
  }

  try {
    await task()
    return true
  } finally {
    try {
      target.setData({ [field]: '' })
    } catch (e) {
      // 页面可能已销毁，忽略 setData 错误
    }
  }
}

module.exports = {
  runButtonAction
}
