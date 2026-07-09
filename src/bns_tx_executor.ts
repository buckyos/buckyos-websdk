// BNS TX executor ,根据runtime的不同，使用不同的方法完成TX的构造和提交
//- 常规网页，或owner无手续费且绑定了sn account：使用sn_client bns_proxy执行 (默认路径)
//- 有buckyosapp扩展/钱包扩展的web runtime,且未绑定sn account：投递给钱包执行 （先不实现）
//- 本地客户端模式，可以直接使用私钥：直接构造TX并用已知私钥签名后提交执行（如果地址无手续费直接失败）