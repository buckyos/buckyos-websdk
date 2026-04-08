/* 
webapp(运行在浏览器中) 使用ndn的缓存机制
以MessageHub为例子:
发送消息：
    (1)浏览器选中File附件，上传得到FileObject,大文件计算可以通过qcid 快速查询（向谁查询?)
    (2)构造MessageObject,其中ref_object包含FileObject的ObjId
        这一步有机会不依赖上传完成，给了产品更多处理的机会
    (3)调用mesage-center 的 send_msg 接口，传入MessageObject
    (4)message-center 将MessageObject投递到remote-ood
    (5)remote-ood message-center触发Pull (如果已经持有该FileObject可以跳过)
        链接zone-gateway,并尝试下载FileObject ()

上述流程中，不同Runtime区别最大的就是 (1)
    理想情况: 直接写入本地的NamedStore后续只有真正用到File的地方才需要创建Reader，否则都可以只靠FileObjId引用
    次选：直接写入当前Node的NamedCache(当前Node上有cyfs-gateway),随后NamedStore以Pull方式，按需从当前Node的NamedCache将FileObject保存好
    最差：本地没有cyfs-gateway,必须使用zone-file-object-http-upload,通过标准的上传接口，上传到远端Node的NamedStore（保底）
        1）调用浏览器选择文件
        2) 计算chunklist,并得到fileobject
        3) 调用zone-file-object-http-upload的接口，上传fileobject(内部会对chunklist进行分片上传)

*/