import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
@Injectable()
export class OrderService {
    constructor(private prisma: PrismaService){}
    async create(){
        return this.prisma.order.create({
            data:{
                userId: ,
                status: 'CREATED'
            }
        })
    }
}
